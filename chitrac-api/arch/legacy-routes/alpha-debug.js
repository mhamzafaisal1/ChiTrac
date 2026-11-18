// Archived unused routes from controllers/alpha/index.js. Not mounted by the application.
const { normalizeMachine, sessionMachineQuery, sessionIdentityQuery } = require('../../utils/sessionIdentity');
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

function recordTimestamps(eventTime) {
  return { create: eventTime, active: eventTime, update: eventTime };
}
const {
  parseAndValidateQueryParams,
  createPaddedTimeRange,
  createMongoDateQuery,
  formatDuration,
  getHourlyIntervals,
  getStateCollectionName,
  getCountCollectionName,
  SYSTEM_TIMEZONE,
} = require("../../utils/time");
const { loadActiveShifts, computeShiftElapsedMs } = require("../../utils/shiftElapsed");
const {
  getShiftTimeComponents,
  getTimeComponentsFromTimestamp,
  addDerivedShiftTimeComponents,
} = require("../../utils/shiftTimeComponents");
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
const schedule = require("node-schedule");
const { sendScheduledJobTestEmail } = require("../../modules/sendScheduledJobTestEmail");


module.exports = function archivedRoutes(server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;

router.get("/historic-data-test", async (req, res) => {
    try {
      const { start, end } = parseAndValidateQueryParams(req);

      // Use latest timestamp from "state-test" instead of "state"
      const [latestState] = await db
        .collection("state-test")
        .find()
        .sort({ "timestamps.create": -1 })
        .limit(1)
        .toArray();

      const effectiveEnd =
        new Date(end) > new Date() ? latestState?.timestamps?.create || new Date() : end;

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
          (a, b) => new Date(a.timestamps?.create) - new Date(b.timestamps?.create)
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
};
