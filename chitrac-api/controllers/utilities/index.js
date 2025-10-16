/*** Utilites API controller */

/** MODULE REQUIRES */
const express = require("express");
const config = require("../../modules/config");
const router = express.Router();
const { DateTime, Duration, Interval } = require("luxon"); //For handling dates and times
const ObjectId = require("mongodb").ObjectId;
const startupDT = DateTime.now();
const bcrypt = require("bcryptjs");


module.exports = function (server) {
  return constructor(server);
};

function constructor(server) {
  const db = server.db;
  const logger = server.logger;
  const passport = server.passport;



  // Helper function to normalize PPM to PPH
  function normalizePPH(std) {
    const n = Number(std) || 0;
    return n < 60 ? n * 60 : n; // treat <60 as PPM => convert to PPH
  }

  // Helper function to get operator name from database
  async function getOperatorName(db, operatorId) {
    try {
      const operator = await db.collection('operator').findOne({ code: operatorId });
      return operator?.name || `Operator ${operatorId}`;
    } catch (error) {
      return `Operator ${operatorId}`;
    }
  }

  // Helper function to get item details from database
  async function getItemDetails(db, itemId) {
    try {
      const item = await db.collection('item').findOne({ number: itemId });
      return {
        id: itemId,
        name: item?.name || `Item ${itemId}`,
        standard: item?.standard || 0
      };
    } catch (error) {
      return { id: itemId, name: `Item ${itemId}`, standard: 0 };
    }
  }

  // Helper function to convert program.items object to array
  function extractItemsArray(programItems) {
    if (!programItems) return [];
    if (Array.isArray(programItems)) return programItems;
    
    // Convert object with numeric keys to array
    const itemsArray = [];
    Object.keys(programItems).forEach(key => {
      if (programItems[key] && programItems[key].id) {
        itemsArray.push(programItems[key]);
      }
    });
    return itemsArray;
  }

  router.get("/backfill", async (req, res) => {
    try {
      // Step 1: Parse and validate input date
      const { date, overwrite } = req.query;
      
      if (!date) {
        return res.status(400).json({ error: "Date parameter is required (format: YYYY-MM-DD)" });
      }

      const inputDate = DateTime.fromISO(date, { zone: 'America/Chicago' });
      if (!inputDate.isValid) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      const allowOverwrite = overwrite === 'true';

      // Calculate day boundaries
      const dayStart = inputDate.startOf('day').toJSDate();
      const dayEnd = inputDate.endOf('day').toJSDate();

      logger.info(`Backfilling sessions for ${date} (${dayStart.toISOString()} to ${dayEnd.toISOString()}) - Overwrite: ${allowOverwrite}`);

      // Step 2: Get collection references
      const machineSessionColl = db.collection('machine-session');
      const operatorSessionColl = db.collection('operator-session');
      const itemSessionColl = db.collection('item-session');
      const faultSessionColl = db.collection('fault-session');
      const stateColl = db.collection('state');
      const countColl = db.collection('count');
      
      // Check for existing sessions across all session types
      const [existingMachineSessions, existingOperatorSessions, existingItemSessions, existingFaultSessions] = await Promise.all([
        machineSessionColl.find({ 'timestamps.start': { $gte: dayStart, $lte: dayEnd } }).toArray(),
        operatorSessionColl.find({ 'timestamps.start': { $gte: dayStart, $lte: dayEnd } }).toArray(),
        itemSessionColl.find({ 'timestamps.start': { $gte: dayStart, $lte: dayEnd } }).toArray(),
        faultSessionColl.find({ 'timestamps.start': { $gte: dayStart, $lte: dayEnd } }).toArray()
      ]);

      const totalExisting = existingMachineSessions.length + existingOperatorSessions.length + 
                            existingItemSessions.length + existingFaultSessions.length;

      // TODO: UNCOMMENT TO ENABLE SESSION EXISTENCE BLOCKING
      /*
      if (totalExisting > 0 && !allowOverwrite) {
        return res.status(409).json({ 
          error: "Sessions already exist for this date. Use ?overwrite=true to force rebuild.",
          existingSessions: {
            machineSessions: existingMachineSessions.length,
            operatorSessions: existingOperatorSessions.length,
            itemSessions: existingItemSessions.length,
            faultSessions: existingFaultSessions.length,
            total: totalExisting
          }
        });
      }
      */

      // Build set of machine serials that already have sessions (to skip if not overwriting)
      const existingSerials = new Set(existingMachineSessions.map(s => s.machine?.serial).filter(Boolean));
      
      if (existingSerials.size > 0) {
        logger.warn(`Found existing sessions for ${existingSerials.size} machines on ${date}. ${allowOverwrite ? 'Will overwrite.' : 'Will skip.'}`);
      }

      // TODO: UNCOMMENT TO ENABLE OVERWRITE (Delete existing sessions)
      /*
      if (allowOverwrite && totalExisting > 0) {
        logger.info(`Deleting ${totalExisting} existing sessions for ${date}...`);
        
        const deleteResults = await Promise.all([
          machineSessionColl.deleteMany({ 'timestamps.start': { $gte: dayStart, $lte: dayEnd } }),
          operatorSessionColl.deleteMany({ 'timestamps.start': { $gte: dayStart, $lte: dayEnd } }),
          itemSessionColl.deleteMany({ 'timestamps.start': { $gte: dayStart, $lte: dayEnd } }),
          faultSessionColl.deleteMany({ 'timestamps.start': { $gte: dayStart, $lte: dayEnd } })
        ]);
        
        const totalDeleted = deleteResults.reduce((sum, result) => sum + result.deletedCount, 0);
        logger.info(`Deleted ${totalDeleted} existing sessions`);
        
        // Clear the existingSerials set since we deleted them
        existingSerials.clear();
      }
      */

      // Step 3: Query all states for the day, sorted chronologically
      const allStates = await stateColl.find({
        timestamp: { $gte: dayStart, $lte: dayEnd }
      }).sort({ timestamp: 1 }).toArray();

      if (allStates.length === 0) {
        return res.status(404).json({ 
          error: "No state records found for this date",
          date: date,
          dayStart: dayStart.toISOString(),
          dayEnd: dayEnd.toISOString()
        });
      }

      logger.info(`Found ${allStates.length} state records for ${date}`);

      // Step 4: Query all counts for the day
      const allCounts = await countColl.find({
        timestamp: { $gte: dayStart, $lte: dayEnd }
      }).sort({ timestamp: 1 }).toArray();

      logger.info(`Found ${allCounts.length} count records for ${date}`);

      // Step 5: Group states by machine
      const statesByMachine = {};
      for (const state of allStates) {
        const serial = state.machine?.serial;
        if (!serial) continue;
        
        if (!statesByMachine[serial]) {
          statesByMachine[serial] = {
            machine: state.machine,
            states: []
          };
        }
        statesByMachine[serial].states.push(state);
      }

      // Step 6: Group counts by machine
      const countsByMachine = {};
      for (const count of allCounts) {
        const serial = count.machine?.serial;
        if (!serial) continue;
        
        if (!countsByMachine[serial]) {
          countsByMachine[serial] = [];
        }
        countsByMachine[serial].push(count);
      }

      // Results containers
      const backfilledSessions = {
        machineSessions: [],
        operatorSessions: [],
        itemSessions: [],
        faultSessions: []
      };

      const skippedMachines = [];

      // Helper function to end machine session
      async function endMachineSession(session, endState) {
        session.timestamps.end = endState.timestamp;
        session.endState = endState;
        session.states.push(endState);

        // Calculate stats
        const start = DateTime.fromJSDate(session.timestamps.start);
        const end = DateTime.fromJSDate(session.timestamps.end);
        const runtime = end.diff(start, 'seconds').seconds;

        const activeStations = Array.isArray(session.operators) ? session.operators.filter(op => op.id !== -1).length : 0;
        const workTime = runtime * activeStations;

        const totalCount = session.counts.length;
        const misfeedCount = session.misfeeds.length;

        // Calculate per-item stats
        let totalTimeCredit = 0;
        const totalByItem = [];
        const timeCreditByItem = [];

        if (session.items.length === 1) {
          const item = session.items[0];
          const pph = normalizePPH(item.standard);
          if (pph > 0) {
            totalTimeCredit = totalCount / (pph / 3600);
            totalByItem.push(totalCount);
            timeCreditByItem.push(Number(totalTimeCredit.toFixed(2)));
          } else {
            totalByItem.push(0);
            timeCreditByItem.push(0);
          }
        } else {
          const itemTypeCounts = {};
          for (const count of session.counts) {
            const itemId = count.item?.id;
            if (itemId) {
              itemTypeCounts[itemId] = (itemTypeCounts[itemId] || 0) + 1;
            }
          }

          for (const item of session.items) {
            const countTotal = itemTypeCounts[item.id] || 0;
            const pph = normalizePPH(item.standard);

            totalByItem.push(countTotal);

            if (pph > 0) {
              const itemTimeCredit = countTotal / (pph / 3600);
              timeCreditByItem.push(Number(itemTimeCredit.toFixed(2)));
              totalTimeCredit += itemTimeCredit;
            } else {
              timeCreditByItem.push(0);
            }
          }
        }

        session.activeStations = activeStations;
        session.runtime = Math.round(runtime);
        session.workTime = Math.round(workTime);
        session.totalCount = totalCount;
        session.misfeedCount = misfeedCount;
        session.totalTimeCredit = Number(totalTimeCredit.toFixed(2));
        session.totalByItem = totalByItem;
        session.timeCreditByItem = timeCreditByItem;
      }

      // Helper function to end operator session
      async function endOperatorSession(session, endState) {
        session.timestamps.end = endState.timestamp;
        session.endState = endState;
        session.states.push(endState);

        const start = DateTime.fromJSDate(session.timestamps.start);
        const end = DateTime.fromJSDate(session.timestamps.end);
        const runtime = end.diff(start, 'seconds').seconds;
        const workTime = runtime;

        const totalCount = session.counts.length;
        const misfeedCount = session.misfeeds.length;

        const byItem = session.items.map((it) => {
          const countTotal = session.counts.reduce((acc, c) => acc + (c.item?.id === it.id ? 1 : 0), 0);
          const pph = normalizePPH(Number(it.standard) || 0);
          const tci = pph > 0 ? countTotal / (pph / 3600) : 0;
          return { countTotal, tci };
        });

        const totalCountByItem = byItem.map(x => x.countTotal);
        const timeCreditByItem = byItem.map(x => Number(x.tci.toFixed(2)));
        const totalTimeCredit = Number(byItem.reduce((a, x) => a + x.tci, 0).toFixed(2));

        session.runtime = Math.round(runtime);
        session.workTime = Math.round(workTime);
        session.totalCount = totalCount;
        session.misfeedCount = misfeedCount;
        session.totalCountByItem = totalCountByItem;
        session.timeCreditByItem = timeCreditByItem;
        session.totalTimeCredit = totalTimeCredit;
      }

      // Helper function to end item session
      async function endItemSession(session, endState) {
        session.timestamps.end = endState.timestamp;
        session.endState = endState;
        session.states.push(endState);

        const start = DateTime.fromJSDate(session.timestamps.start);
        const end = DateTime.fromJSDate(session.timestamps.end);
        const runtime = end.diff(start, 'seconds').seconds;

        const activeStations = Array.isArray(session.operators) ? session.operators.length : 0;
        const workTime = runtime * activeStations;

        const itemId = session.item?.id;
        const totalCount = (session.counts || []).filter(c => c.item?.id === itemId).length;
        const misfeedCount = (session.misfeeds || []).filter(m => m.item?.id === itemId).length;

        const std = Number(session.item?.standard) || 0;
        const pph = std < 60 ? std * 60 : std;
        const totalTimeCredit = pph > 0 ? Number((totalCount / (pph / 3600)).toFixed(2)) : 0;

        session.activeStations = activeStations;
        session.runtime = Math.round(runtime);
        session.workTime = Math.round(workTime);
        session.totalCount = totalCount;
        session.misfeedCount = misfeedCount;
        session.totalTimeCredit = totalTimeCredit;
      }

      // Step 7: Process each machine's states to create sessions
      for (const [serial, machineData] of Object.entries(statesByMachine)) {
        const serialNum = parseInt(serial);
        
        // Skip machines that already have sessions (unless overwrite is enabled)
        if (existingSerials.has(serialNum) && !allowOverwrite) {
          logger.info(`Skipping machine ${serialNum} - sessions already exist`);
          skippedMachines.push({ serial: serialNum, reason: 'Sessions already exist' });
          continue;
        }
        
        const states = machineData.states;
        const counts = countsByMachine[serial] || [];
        
        logger.info(`Processing ${states.length} states for machine ${serial}`);

        // Track active sessions
        let currentMachineSession = null;
        let currentOperatorSessions = new Map(); // operatorId -> session
        let currentItemSessions = new Map(); // itemId -> session
        let currentFaultSession = null;

        for (let i = 0; i < states.length; i++) {
          const state = states[i];
          const statusCode = state.status?.code;

          // Check if this is a Running state (code 1)
          if (statusCode === 1) {
            // Start new machine session if not already in one
            if (!currentMachineSession) {
              // Get unique items from program.items
              const itemsInProgram = extractItemsArray(state.program?.items);
              const uniqueItemIds = [...new Set(itemsInProgram.map(it => it.id).filter(id => id && id > 0))];
              
              // Get item details from database
              const itemsWithDetails = await Promise.all(
                uniqueItemIds.map(id => getItemDetails(db, id))
              );

              // Get operator details with names
              const operatorsWithNames = await Promise.all(
                (state.operators || [])
                  .filter(op => op.id !== -1)
                  .map(async (op) => ({
                    id: op.id,
                    name: await getOperatorName(db, op.id),
                    station: op.station
                  }))
              );

              // Create machine session
              currentMachineSession = {
                timestamps: { start: state.timestamp },
                counts: [],
                misfeeds: [],
                states: [state],
                items: itemsWithDetails,
                operators: operatorsWithNames,
                startState: state,
                machine: state.machine,
                program: {
                  mode: state.program?.mode || "smallPiece",
                  programNumber: state.program?.programNumber || 1,
                  batchNumber: state.program?.batchNumber || 0,
                  accountNumber: state.program?.accountNumber || 0,
                  speed: state.program?.speed || 0,
                  stations: state.program?.stations || 0
                },
                totalByItem: itemsWithDetails.map(() => 0),
                timeCreditByItem: itemsWithDetails.map(() => 0)
              };

              // Start operator sessions
              for (const op of operatorsWithNames) {
                const opSession = {
                  timestamps: { start: state.timestamp },
                  counts: [],
                  misfeeds: [],
                  states: [state],
                  items: itemsWithDetails,
                  operator: op,
                  startState: state,
                  machine: state.machine,
                  program: currentMachineSession.program,
                  runtime: 0,
                  workTime: 0,
                  totalCount: 0,
                  misfeedCount: 0,
                  totalCountByItem: itemsWithDetails.map(() => 0),
                  timeCreditByItem: itemsWithDetails.map(() => 0),
                  totalTimeCredit: 0
                };
                currentOperatorSessions.set(op.id, opSession);
              }

              // Start item sessions
              for (const item of itemsWithDetails) {
                const itemSession = {
                  timestamps: { start: state.timestamp },
                  counts: [],
                  misfeeds: [],
                  states: [state],
                  item: item,
                  operators: operatorsWithNames,
                  startState: state,
                  machine: state.machine,
                  program: currentMachineSession.program,
                  activeStations: operatorsWithNames.length,
                  runtime: 0,
                  workTime: 0,
                  totalCount: 0,
                  misfeedCount: 0,
                  totalTimeCredit: 0
                };
                currentItemSessions.set(item.id, itemSession);
              }

              logger.info(`Started machine session for ${serial} at ${state.timestamp.toISOString()}`);
            } else {
              // Add state to existing session
              currentMachineSession.states.push(state);
              currentOperatorSessions.forEach(opSession => opSession.states.push(state));
              currentItemSessions.forEach(itemSession => itemSession.states.push(state));
            }

            // End fault session if one is active
            if (currentFaultSession) {
              currentFaultSession.timestamps.end = state.timestamp;
              currentFaultSession.endState = state;
              currentFaultSession.states.push(state);

              // Calculate fault session stats
              const faultStart = DateTime.fromJSDate(currentFaultSession.timestamps.start);
              const faultEnd = DateTime.fromJSDate(currentFaultSession.timestamps.end);
              const faulttime = faultEnd.diff(faultStart, 'seconds').seconds;
              const activeStations = Array.isArray(currentFaultSession.operators) ? currentFaultSession.operators.length : 0;
              const workTimeMissed = faulttime * activeStations;

              currentFaultSession.faulttime = Math.round(faulttime);
              currentFaultSession.workTimeMissed = Math.round(workTimeMissed);
              currentFaultSession.activeStations = activeStations;

              backfilledSessions.faultSessions.push(currentFaultSession);
              currentFaultSession = null;
            }
          } 
          // Check if this is a Fault state (code >= 2)
          else if (statusCode >= 2) {
            // End machine session if one is active
            if (currentMachineSession) {
              await endMachineSession(currentMachineSession, state);
              backfilledSessions.machineSessions.push(currentMachineSession);
              
              // End operator sessions
              for (const [opId, opSession] of currentOperatorSessions) {
                await endOperatorSession(opSession, state);
                backfilledSessions.operatorSessions.push(opSession);
              }
              currentOperatorSessions.clear();

              // End item sessions
              for (const [itemId, itemSession] of currentItemSessions) {
                await endItemSession(itemSession, state);
                backfilledSessions.itemSessions.push(itemSession);
              }
              currentItemSessions.clear();

              currentMachineSession = null;
            }

            // Start fault session if not already in one
            if (!currentFaultSession) {
              // Get unique items from program.items
              const itemsInProgram = extractItemsArray(state.program?.items);
              const uniqueItemIds = [...new Set(itemsInProgram.map(it => it.id).filter(id => id && id > 0))];
              
              const itemsWithDetails = await Promise.all(
                uniqueItemIds.map(id => getItemDetails(db, id))
              );

              const operatorsWithNames = await Promise.all(
                (state.operators || [])
                  .filter(op => op.id !== -1)
                  .map(async (op) => ({
                    id: op.id,
                    name: await getOperatorName(db, op.id),
                    station: op.station
                  }))
              );

              currentFaultSession = {
                timestamps: { start: state.timestamp },
                items: itemsWithDetails,
                operators: operatorsWithNames,
                states: [state],
                startState: state,
                machine: state.machine,
                program: {
                  mode: state.program?.mode || "smallPiece",
                  programNumber: state.program?.programNumber || 1,
                  batchNumber: state.program?.batchNumber || 0,
                  accountNumber: state.program?.accountNumber || 0,
                  speed: state.program?.speed || 0,
                  stations: state.program?.stations || 0
                },
                activeStations: operatorsWithNames.length
              };
            } else {
              // Add state to existing fault session
              currentFaultSession.states.push(state);
            }
          }
          // Timeout state (code 0)
          else if (statusCode === 0) {
            // End machine session if one is active
            if (currentMachineSession) {
              await endMachineSession(currentMachineSession, state);
              backfilledSessions.machineSessions.push(currentMachineSession);
              
              // End operator sessions
              for (const [opId, opSession] of currentOperatorSessions) {
                await endOperatorSession(opSession, state);
                backfilledSessions.operatorSessions.push(opSession);
              }
              currentOperatorSessions.clear();

              // End item sessions
              for (const [itemId, itemSession] of currentItemSessions) {
                await endItemSession(itemSession, state);
                backfilledSessions.itemSessions.push(itemSession);
              }
              currentItemSessions.clear();

              currentMachineSession = null;
            }

            // End fault session if one is active
            if (currentFaultSession) {
              currentFaultSession.timestamps.end = state.timestamp;
              currentFaultSession.endState = state;
              currentFaultSession.states.push(state);

              // Calculate fault session stats
              const faultStart = DateTime.fromJSDate(currentFaultSession.timestamps.start);
              const faultEnd = DateTime.fromJSDate(currentFaultSession.timestamps.end);
              const faulttime = faultEnd.diff(faultStart, 'seconds').seconds;
              const activeStations = Array.isArray(currentFaultSession.operators) ? currentFaultSession.operators.length : 0;
              const workTimeMissed = faulttime * activeStations;

              currentFaultSession.faulttime = Math.round(faulttime);
              currentFaultSession.workTimeMissed = Math.round(workTimeMissed);
              currentFaultSession.activeStations = activeStations;

              backfilledSessions.faultSessions.push(currentFaultSession);
              currentFaultSession = null;
            }
          }
        }

        // End any remaining open sessions at end of day
        if (currentMachineSession) {
          const endState = states[states.length - 1];
          await endMachineSession(currentMachineSession, endState);
          backfilledSessions.machineSessions.push(currentMachineSession);

          for (const [opId, opSession] of currentOperatorSessions) {
            await endOperatorSession(opSession, endState);
            backfilledSessions.operatorSessions.push(opSession);
          }

          for (const [itemId, itemSession] of currentItemSessions) {
            await endItemSession(itemSession, endState);
            backfilledSessions.itemSessions.push(itemSession);
          }
        }

        if (currentFaultSession) {
          const endState = states[states.length - 1];
          currentFaultSession.timestamps.end = endState.timestamp;
          currentFaultSession.endState = endState;
          
          const faultStart = DateTime.fromJSDate(currentFaultSession.timestamps.start);
          const faultEnd = DateTime.fromJSDate(currentFaultSession.timestamps.end);
          const faulttime = faultEnd.diff(faultStart, 'seconds').seconds;
          const activeStations = Array.isArray(currentFaultSession.operators) ? currentFaultSession.operators.length : 0;

          currentFaultSession.faulttime = Math.round(faulttime);
          currentFaultSession.workTimeMissed = Math.round(faulttime * activeStations);
          currentFaultSession.activeStations = activeStations;

          backfilledSessions.faultSessions.push(currentFaultSession);
        }

        // Step 8: Assign counts to sessions
        for (const count of counts) {
          const countTime = count.timestamp;
          let assignedToMachineSession = false;
          let assignedToOperatorSession = false;
          let assignedToItemSession = false;
          
          // Find which machine session this count belongs to
          for (const session of backfilledSessions.machineSessions) {
            if (session.machine.serial !== serialNum) continue;
            
            const sessionStart = session.timestamps.start;
            const sessionEnd = session.timestamps.end || dayEnd;
            
            if (countTime >= sessionStart && countTime <= sessionEnd) {
              if (count.misfeed) {
                session.misfeeds.push(count);
              } else {
                session.counts.push(count);
              }
              assignedToMachineSession = true;
              break;
            }
          }

          // Assign to operator session (one count per operator session)
          if (assignedToMachineSession) {
            for (const session of backfilledSessions.operatorSessions) {
              if (session.machine.serial !== serialNum) continue;
              if (session.operator.id !== count.operator?.id) continue;
              
              const sessionStart = session.timestamps.start;
              const sessionEnd = session.timestamps.end || dayEnd;
              
              if (countTime >= sessionStart && countTime <= sessionEnd) {
                if (count.misfeed) {
                  session.misfeeds.push(count);
                } else {
                  session.counts.push(count);
                }
                assignedToOperatorSession = true;
                break;
              }
            }
          }

          // Assign to item session (one count per item session)
          if (assignedToMachineSession) {
            for (const session of backfilledSessions.itemSessions) {
              if (session.machine.serial !== serialNum) continue;
              if (session.item.id !== count.item?.id) continue;
              
              const sessionStart = session.timestamps.start;
              const sessionEnd = session.timestamps.end || dayEnd;
              
              if (countTime >= sessionStart && countTime <= sessionEnd) {
                if (count.misfeed) {
                  session.misfeeds.push(count);
                } else {
                  session.counts.push(count);
                }
                assignedToItemSession = true;
                break;
              }
            }
          }
        }
      }

      // Step 9: Insert sessions into database
      let insertedCounts = {
        machineSessions: 0,
        operatorSessions: 0,
        itemSessions: 0,
        faultSessions: 0
      };

      // Insert only new sessions (skip machines that already have sessions)
      if (backfilledSessions.machineSessions.length > 0) {
        const result = await machineSessionColl.insertMany(backfilledSessions.machineSessions);
        insertedCounts.machineSessions = result.insertedCount;
        logger.info(`Inserted ${result.insertedCount} machine sessions`);
      }

      if (backfilledSessions.operatorSessions.length > 0) {
        const result = await operatorSessionColl.insertMany(backfilledSessions.operatorSessions);
        insertedCounts.operatorSessions = result.insertedCount;
        logger.info(`Inserted ${result.insertedCount} operator sessions`);
      }

      if (backfilledSessions.itemSessions.length > 0) {
        const result = await itemSessionColl.insertMany(backfilledSessions.itemSessions);
        insertedCounts.itemSessions = result.insertedCount;
        logger.info(`Inserted ${result.insertedCount} item sessions`);
      }

      if (backfilledSessions.faultSessions.length > 0) {
        const result = await faultSessionColl.insertMany(backfilledSessions.faultSessions);
        insertedCounts.faultSessions = result.insertedCount;
        logger.info(`Inserted ${result.insertedCount} fault sessions`);
      }

      // Step 10: Check for gaps (sessions missing after this date)
      const nextDay = inputDate.plus({ days: 1 }).startOf('day').toJSDate();
      const now = new Date();
      
      let gapEndDate = null;
      let currentCheckDate = nextDay;
      
      while (currentCheckDate < now) {
        const checkDayEnd = DateTime.fromJSDate(currentCheckDate).endOf('day').toJSDate();
        
        const sessionsExist = await machineSessionColl.findOne({
          'timestamps.start': { $gte: currentCheckDate, $lte: checkDayEnd }
        });
        
        if (sessionsExist) {
          break; // Found sessions, gap ends
        }
        
        gapEndDate = currentCheckDate;
        currentCheckDate = DateTime.fromJSDate(currentCheckDate).plus({ days: 1 }).startOf('day').toJSDate();
      }

      res.json({
        success: true,
        date: date,
        overwriteEnabled: allowOverwrite,
        backfilled: {
          counts: insertedCounts,
          sessions: {
            machineSessions: backfilledSessions.machineSessions,
            operatorSessions: backfilledSessions.operatorSessions,
            itemSessions: backfilledSessions.itemSessions,
            faultSessions: backfilledSessions.faultSessions
          }
        },
        summary: {
          statesProcessed: allStates.length,
          countsProcessed: allCounts.length,
          machinesTotal: Object.keys(statesByMachine).length,
          machinesProcessed: Object.keys(statesByMachine).length - skippedMachines.length,
          machinesSkipped: skippedMachines.length,
          totalSessionsCreated: insertedCounts.machineSessions + insertedCounts.operatorSessions + insertedCounts.itemSessions + insertedCounts.faultSessions
        },
        skipped: skippedMachines,
        existing: totalExisting > 0 ? {
          machineSessions: existingMachineSessions.length,
          operatorSessions: existingOperatorSessions.length,
          itemSessions: existingItemSessions.length,
          faultSessions: existingFaultSessions.length,
          total: totalExisting
        } : null,
        gap: gapEndDate ? {
          message: `Sessions are missing from ${date} until ${DateTime.fromJSDate(gapEndDate).toISODate()}`,
          startDate: date,
          endDate: DateTime.fromJSDate(gapEndDate).toISODate()
        } : null
      });
    } catch (error) {
      logger.error(`Error in ${req.method} ${req.url}:`, error);

      res
        .status(500)
        .json({ error: "Failed to backfill sessions", details: error.message });
    }
  });

  return router;
}