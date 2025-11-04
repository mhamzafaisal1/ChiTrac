



// async function getBookendedStatesAndTimeRange(db, serial, start, end) {
//     const serialNum = parseInt(serial);
//     const startDate = new Date(start);
//     const endDate = new Date(end);
  
//     const inRangeStatesQ = db.collection("state")
//       .find({
//         "machine.serial": serialNum,
//         timestamp: { $gte: startDate, $lte: endDate }
//       })
//       .sort({ timestamp: 1 });
  
//     const beforeStartQ = db.collection("state")
//       .find({
//         "machine.serial": serialNum,
//         timestamp: { $lt: startDate }
//       })
//       .sort({ timestamp: -1 })
//       .limit(1);
  
//     const afterEndQ = db.collection("state")
//       .find({
//         "machine.serial": serialNum,
//         timestamp: { $gt: endDate }
//       })
//       .sort({ timestamp: 1 })
//       .limit(1);
  
//     const [inRangeStates, [beforeStart], [afterEnd]] = await Promise.all([
//       inRangeStatesQ.toArray(),
//       beforeStartQ.toArray(),
//       afterEndQ.toArray()
//     ]);
  
//     const states = [
//       ...(beforeStart ? [beforeStart] : []),
//       ...inRangeStates,
//       ...(afterEnd ? [afterEnd] : [])
//     ];
  
//     if (!states.length) return null;
  
//     // Identify the true session start and end
//     let trueStart = null;
//     let trueEnd = null;
//     let inSession = false;
  
//     for (const state of states) {
//       if (state.status?.code === 1 && !inSession) {
//         trueStart = state.timestamp;
//         inSession = true;
//       } else if (inSession && state.status?.code !== 1) {
//         trueEnd = state.timestamp;
//         inSession = false;
//       }
//     }
  
//     // If session still running at end
//     if (inSession) {
//       trueEnd = afterEnd?.timestamp || states.at(-1).timestamp;
//     }
  
//     return {
//       states,
//       sessionStart: trueStart || states[0].timestamp,
//       sessionEnd: trueEnd || states.at(-1).timestamp
//     };
//   }

const { extractAllCyclesFromStates } = require('./state');
const { getStateCollectionName } = require('./time');

/**
 * Returns bookended state data and true session start/end times per machine
 * @param {Object} db - MongoDB instance
 * @param {Number} serial - Machine serial
 * @param {Date} start - Raw user-provided start time
 * @param {Date} end - Raw user-provided end time
 * @returns {Object|null} { sessionStart, sessionEnd, states } OR null if nothing found
 */
// async function getBookendedStatesAndTimeRange(db, serial, start, end) {
//   // Fetch all states for this machine in the given range
//   const states = await db.collection('state')
//     .find({
//       'machine.serial': serial,
//       timestamp: { $gte: new Date(start), $lte: new Date(end) }
//     })
//     .sort({ timestamp: 1 })
//     .toArray();

//   if (!states.length) return null;

//   // Extract all Run sessions
//   const { running: runSessions } = extractAllCyclesFromStates(states, start, end);
//   if (!runSessions.length) return null;

//   // True session bounds based on all run session timestamps
//   const sessionStart = runSessions[0].start;
//   const sessionEnd = runSessions[runSessions.length - 1].end;

//   // Filter the states to those within the session bounds
//   const filteredStates = states.filter(s =>
//     new Date(s.timestamp) >= sessionStart &&
//     new Date(s.timestamp) <= sessionEnd
//   );

//   return {
//     sessionStart,
//     sessionEnd,
//     states: filteredStates
//   };
// }

/**
 * Returns bookended state data and true session start/end times per machine
 * @param {Object} db - MongoDB instance
 * @param {Number} serial - Machine serial
 * @param {Date|string} start - Raw user-provided start time
 * @param {Date|string} end - Raw user-provided end time
 * @returns {Object|null} { sessionStart, sessionEnd, states } OR null if nothing found
 */
async function getBookendedStatesAndTimeRange(db, serial, start, end) {
  const serialNum = parseInt(serial);
  let startDate = new Date(start);
  let endDate = new Date(end);
  const now = new Date();

  // Clamp future end date to current time
  if (endDate > now) endDate = now;

  // Convert Date objects to ISO strings for comparison (timestamps.create is stored as ISO strings)
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  // Prepare queries - use appropriate state collection based on time range
  const stateCollection = getStateCollectionName(startDate);
  
  // Support both machine.id and machine.serial, and both timestamp and timestamps.create
  const inRangeStatesQ = db.collection(stateCollection)
    .find({
      $or: [
        {
          $or: [
            { "machine.id": serialNum },
            { "machine.serial": serialNum }
          ],
          "timestamps.create": { $gte: startISO, $lte: endISO }
        },
        {
          $or: [
            { "machine.id": serialNum },
            { "machine.serial": serialNum }
          ],
          timestamp: { $gte: startDate, $lte: endDate }
        }
      ]
    })
    .project({
      timestamp: 1,
      "timestamps.create": 1,
      "machine.serial": 1,
      "machine.id": 1,
      "machine.name": 1,
      "program.mode": 1,
      "status.code": 1,
      "status.name": 1
    })
    .sort({ "timestamps.create": 1, timestamp: 1 });

  const beforeStartQ = db.collection(stateCollection)
    .find({
      $or: [
        {
          $or: [
            { "machine.id": serialNum },
            { "machine.serial": serialNum }
          ],
          "timestamps.create": { $lt: startISO }
        },
        {
          $or: [
            { "machine.id": serialNum },
            { "machine.serial": serialNum }
          ],
          timestamp: { $lt: startDate }
        }
      ]
    })
    .project({
      timestamp: 1,
      "timestamps.create": 1,
      "machine.serial": 1,
      "machine.id": 1,
      "machine.name": 1,
      "program.mode": 1,
      "status.code": 1,
      "status.name": 1
    })
    .sort({ "timestamps.create": -1, timestamp: -1 })
    .limit(1);

  const afterEndQ = db.collection(stateCollection)
    .find({
      $or: [
        {
          $or: [
            { "machine.id": serialNum },
            { "machine.serial": serialNum }
          ],
          "timestamps.create": { $gt: endISO }
        },
        {
          $or: [
            { "machine.id": serialNum },
            { "machine.serial": serialNum }
          ],
          timestamp: { $gt: endDate }
        }
      ]
    })
    .project({
      timestamp: 1,
      "timestamps.create": 1,
      "machine.serial": 1,
      "machine.id": 1,
      "machine.name": 1,
      "program.mode": 1,
      "status.code": 1,
      "status.name": 1
    })
    .sort({ "timestamps.create": 1, timestamp: 1 })
    .limit(1);

  // Execute queries
  const [inRangeStates, [beforeStart], [afterEnd]] = await Promise.all([
    inRangeStatesQ.toArray(),
    beforeStartQ.toArray(),
    afterEndQ.toArray()
  ]);


  // Normalize states: map timestamps.create to timestamp and machine.id to machine.serial
  const normalizeState = (state) => {
    if (!state.timestamp && state.timestamps?.create) {
      state.timestamp = state.timestamps.create;
    }
    if (!state.machine?.serial && state.machine?.id) {
      state.machine = state.machine || {};
      state.machine.serial = state.machine.id;
    }
    return state;
  };

  // Merge and sort states
  const fullStates = [
    ...(beforeStart ? [normalizeState(beforeStart)] : []),
    ...inRangeStates.map(normalizeState),
    ...(afterEnd ? [normalizeState(afterEnd)] : [])
  ].sort((a, b) => {
    const aTime = a.timestamp || a.timestamps?.create;
    const bTime = b.timestamp || b.timestamps?.create;
    return new Date(aTime) - new Date(bTime);
  });

  if (!fullStates.length) return null;

  // Extract Run sessions
  const { running: runSessions } = extractAllCyclesFromStates(fullStates, startDate, endDate);
  if (!runSessions.length) return null;

  const sessionStart = runSessions[0].start;
  const sessionEnd = runSessions.at(-1).end;

  const filteredStates = fullStates.filter(s => {
    const stateTime = s.timestamp || s.timestamps?.create;
    return new Date(stateTime) >= sessionStart &&
           new Date(stateTime) <= sessionEnd;
  });

  return {
    sessionStart,
    sessionEnd,
    states: filteredStates
  };
}


// async function getBookendedOperatorStatesAndTimeRange(db, operatorId, start, end) {
//     const states = await db.collection('state')
//       .find({
//         "operators.id": operatorId,
//         timestamp: { $gte: new Date(start), $lte: new Date(end) }
//       })
//       .sort({ timestamp: 1 })
//       .toArray();
  
//     if (!states.length) return null;
  
//     const { running: runCycles } = require('./state').extractAllCyclesFromStates(states, start, end);
//     if (!runCycles.length) return null;
  
//     const sessionStart = runCycles[0].start;
//     const sessionEnd = runCycles[runCycles.length - 1].end;
  
//     const filteredStates = states.filter(s =>
//       new Date(s.timestamp) >= sessionStart &&
//       new Date(s.timestamp) <= sessionEnd
//     );
  
//     return { sessionStart, sessionEnd, states: filteredStates };
//   }


/**
 * Returns bookended state data and true session start/end times for an operator
 * @param {Object} db - MongoDB instance
 * @param {Number} operatorId - Operator ID to filter
 * @param {Date|string} start - Start datetime
 * @param {Date|string} end - End datetime
 * @returns {Object|null} { sessionStart, sessionEnd, states } or null if no valid run cycle
 */
async function getBookendedOperatorStatesAndTimeRange(db, operatorId, start, end) {
  const now = new Date();
  const startDate = new Date(start);
  let endDate = new Date(end);
  if (endDate > now) endDate = now;

  // Fetch in-range, pre-start, and post-end states - use appropriate state collection
  const stateCollection = getStateCollectionName(startDate);
  
  const inRangeStatesQ = db.collection(stateCollection)
    .find({
      'operators.id': operatorId,
      'timestamps.create': { $gte: startDate, $lte: endDate }
    })
    .sort({ 'timestamps.create': 1 });

  const beforeStartQ = db.collection(stateCollection)
    .find({
      'operators.id': operatorId,
      'timestamps.create': { $lt: startDate }
    })
    .sort({ 'timestamps.create': -1 })
    .limit(1);

  const afterEndQ = db.collection(stateCollection)
    .find({
      'operators.id': operatorId,
      'timestamps.create': { $gt: endDate }
    })
    .sort({ 'timestamps.create': 1 })
    .limit(1);

  const [inRangeStates, [beforeStart], [afterEnd]] = await Promise.all([
    inRangeStatesQ.toArray(),
    beforeStartQ.toArray(),
    afterEndQ.toArray()
  ]);

  const fullStates = [
    ...(beforeStart ? [beforeStart] : []),
    ...inRangeStates,
    ...(afterEnd ? [afterEnd] : [])
  ];

  if (!fullStates.length) return null;

  // Ensure states are sorted chronologically
  fullStates.sort((a, b) => new Date(a.timestamps?.create) - new Date(b.timestamps?.create));

  const { running: runCycles } = extractAllCyclesFromStates(fullStates, startDate, endDate);
  if (!runCycles.length) return null;

  const sessionStart = runCycles[0].start;
  const sessionEnd = runCycles[runCycles.length - 1].end;

  const filteredStates = fullStates.filter(s =>
    new Date(s.timestamps?.create) >= sessionStart && new Date(s.timestamps?.create) <= sessionEnd
  );

  return { sessionStart, sessionEnd, states: filteredStates };
}


  

module.exports = { getBookendedStatesAndTimeRange, getBookendedOperatorStatesAndTimeRange };

  

  