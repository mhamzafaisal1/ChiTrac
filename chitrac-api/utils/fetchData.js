const { getStateCollectionName, getCountCollectionName } = require('./time');

/**
 * Fetches and groups state + count data by machine or operator for a given time range.
 *
 * @param {Db} db - MongoDB instance
 * @param {Date} start - Start time
 * @param {Date} end - End time
 * @param {'machine'|'operator'} groupBy - Whether to group by machine serial or operator ID
 * @param {Object} [options] - Optional filters
 * @param {number[]} [options.targetSerials] - Optional list of machine serials to filter
 * @param {number} [options.operatorId] - Optional operator ID to filter count records
 * @returns {Promise<Object>} Grouped analytics data by machine or operator
 */
// async function fetchGroupedAnalyticsData(db, start, end, groupBy = 'machine', options = {}) {
//   const { targetSerials = [], operatorId = null } = options;

//   const countQuery = {
//     timestamp: { $gte: start, $lte: end },
//     "machine.serial": { $type: "int" }
//   };

//   if (groupBy === 'machine' && targetSerials.length > 0) {
//     countQuery["machine.serial"] = { $in: targetSerials };
//   }

//   if (groupBy === 'operator' && operatorId !== null) {
//     countQuery["operator.id"] = operatorId;
//   }

//   const counts = await db.collection("count")
//     .find(countQuery)
//     .project({
//       timestamp: 1,
//       "machine.serial": 1,
//       "operator.id": 1,
//       "operator.name": 1,
//       "item.id": 1,
//       "item.name": 1,
//       "item.standard": 1,
//       misfeed: 1
//     })
//     .sort({ timestamp: 1 })
//     .toArray();

//   const grouped = {};

//   for (const count of counts) {
//     const key = groupBy === 'machine'
//       ? count.machine?.serial
//       : count.operator?.id;

//     const machineSerial = count.machine?.serial;

//     if (key == null || machineSerial == null) continue;

//     if (!grouped[key]) {
//       grouped[key] = {
//         counts: {
//           all: [],
//           valid: [],
//           misfeed: []
//         },
//         machineSerials: new Set()
//       };
//     }

//     grouped[key].counts.all.push(count);
//     grouped[key].machineSerials.add(machineSerial);

//     if (count.misfeed === true) {
//       grouped[key].counts.misfeed.push(count);
//     } else if (count.operator?.id !== -1) {
//       grouped[key].counts.valid.push(count);
//     }
//   }

//   // Gather all unique serials from grouped object (to fetch states only once)
//   const allSerials = new Set();
//   for (const obj of Object.values(grouped)) {
//     for (const serial of obj.machineSerials) {
//       allSerials.add(serial);
//     }
//   }

//   const stateQuery = {
//     timestamp: { $gte: start, $lte: end },
//     "machine.serial": { $in: [...allSerials] }
//   };

//   const states = await db.collection("state")
//     .find(stateQuery)
//     .project({
//       timestamp: 1,
//       "machine.serial": 1,
//       "machine.name": 1,
//       "program.mode": 1,
//       "status.code": 1,
//       "status.name": 1
//     })
//     .sort({ timestamp: 1 })
//     .toArray();

//   // Assign states to each group (operator or machine) based on serials
//   for (const key of Object.keys(grouped)) {
//     const serials = grouped[key].machineSerials;
//     const matchedStates = states.filter(s => serials.has(s.machine?.serial));
  
//     grouped[key].states = matchedStates;
  
//     // Attach machine name map for each group
//     const serialToNameMap = {};
//     for (const s of matchedStates) {
//       if (s.machine?.serial && s.machine?.name) {
//         serialToNameMap[s.machine.serial] = s.machine.name;
//       }
//     }
  
//     grouped[key].machineNames = serialToNameMap;
  
//     delete grouped[key].machineSerials;
//   }
  
//   return grouped;
// }


async function fetchGroupedAnalyticsData(db, start, end, groupBy = 'machine', options = {}) {
    const { targetSerials = [], operatorId = null } = options;
    
    // Convert Date objects to ISO strings for comparison (timestamps.create is stored as ISO strings)
    const startISO = start instanceof Date ? start.toISOString() : start;
    const endISO = end instanceof Date ? end.toISOString() : end;
    
    // Construct count query - handle both machine.serial and machine.id fields
    // Use timestamps.create instead of timestamp (documents use timestamps.create)
    const countQuery = {
        "timestamps.create": { $gte: startISO, $lte: endISO },
        $or: [
            { "machine.serial": { $type: "int" } },
            { "machine.id": { $type: "int" } }
        ]
    };
    
    if (groupBy === 'machine' && targetSerials.length > 0) {
        // Support both machine.serial and machine.id in the filter
        countQuery.$or = [
            { "machine.serial": { $in: targetSerials } },
            { "machine.id": { $in: targetSerials } }
        ];
    }
    
    if (groupBy === 'operator' && operatorId !== null) {
        countQuery["operator.id"] = operatorId;
    }

    // Fetch counts first if grouping by operator, then fetch only relevant states
    let states = [];
    const countCollection = getCountCollectionName(start);
    
    let counts = await db.collection(countCollection)
        .find(countQuery)
        .project({
            "timestamps.create": 1,
            "machine.serial": 1,
            "machine.id": 1,
            "operator.id": 1,
            "operator.name": 1,
            "item.id": 1,
            "item.name": 1,
            "item.standard": 1,
            misfeed: 1
        })
        .sort({ "timestamps.create": 1 })
        .toArray();

    // Normalize documents: map timestamps.create to timestamp and machine.id to machine.serial
    counts = counts.map(count => {
        // Normalize timestamp field - use timestamps.create if timestamp doesn't exist
        if (!count.timestamp && count.timestamps?.create) {
            count.timestamp = count.timestamps.create;
        }
        // Normalize machine.serial field - use machine.id if machine.serial doesn't exist
        if (!count.machine?.serial && count.machine?.id) {
            count.machine = count.machine || {};
            count.machine.serial = count.machine.id;
        }
        return count;
    });

    if (groupBy === 'operator') {
        // 🔥 Get machine.serials used in count records
        const machineSerialsUsed = Array.from(
            new Set(counts.map(c => c.machine?.serial).filter(Boolean))
        );
        // State query - handle both timestamp and timestamps.create, and machine.serial/id
        const stateQuery = {
            $or: [
                {
                    timestamp: { $gte: start, $lte: end },
                    $or: [
                        { "machine.serial": { $in: machineSerialsUsed } },
                        { "machine.id": { $in: machineSerialsUsed } }
                    ]
                },
                {
                    "timestamps.create": { $gte: startISO, $lte: endISO },
                    $or: [
                        { "machine.serial": { $in: machineSerialsUsed } },
                        { "machine.id": { $in: machineSerialsUsed } }
                    ]
                }
            ]
        };
        const stateCollection = getStateCollectionName(start);
        states = await db.collection(stateCollection)
            .find(stateQuery)
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
            .sort({ timestamp: 1, "timestamps.create": 1 })
            .toArray();
    } else {
        // Construct state query - handle both timestamp and timestamps.create
        const stateQuery = {
            $or: [
                {
                    timestamp: { $gte: start, $lte: end },
                    $or: [
                        { "machine.serial": { $type: "int" } },
                        { "machine.id": { $type: "int" } }
                    ]
                },
                {
                    "timestamps.create": { $gte: startISO, $lte: endISO },
                    $or: [
                        { "machine.serial": { $type: "int" } },
                        { "machine.id": { $type: "int" } }
                    ]
                }
            ]
        };
        if (groupBy === 'machine' && targetSerials.length > 0) {
            stateQuery.$or = [
                {
                    timestamp: { $gte: start, $lte: end },
                    $or: [
                        { "machine.serial": { $in: targetSerials } },
                        { "machine.id": { $in: targetSerials } }
                    ]
                },
                {
                    "timestamps.create": { $gte: startISO, $lte: endISO },
                    $or: [
                        { "machine.serial": { $in: targetSerials } },
                        { "machine.id": { $in: targetSerials } }
                    ]
                }
            ];
        }
        const stateCollection = getStateCollectionName(start);
        states = await db.collection(stateCollection)
            .find(stateQuery)
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
            .sort({ timestamp: 1, "timestamps.create": 1 })
            .toArray();
    }

    // Normalize state documents: map timestamps.create to timestamp and machine.id to machine.serial
    states = states.map(state => {
        // Normalize timestamp field
        if (!state.timestamp && state.timestamps?.create) {
            state.timestamp = state.timestamps.create;
        }
        // Normalize machine.serial field
        if (!state.machine?.serial && state.machine?.id) {
            state.machine = state.machine || {};
            state.machine.serial = state.machine.id;
        }
        return state;
    });

    const grouped = {};
    
    // Create machine name map
    const machineNameMap = {};
    for (const state of states) {
        if (state.machine?.serial && state.machine?.name) {
            machineNameMap[state.machine.serial] = state.machine.name;
        }
    }
    
    // Group states and counts based on groupBy
    if (groupBy === 'machine') {
        // Group states by machine
        for (const state of states) {
            const serial = state.machine?.serial;
            if (serial === undefined || serial === null) continue;
            
            if (!grouped[serial]) {
                grouped[serial] = {
                    states: [],
                    counts: {
                        all: [],
                        valid: [],
                        misfeed: []
                    },
                    machineNames: machineNameMap
                };
            }
            
            grouped[serial].states.push(state);
        }
        
        // Group counts by machine
        for (const count of counts) {
            const serial = count.machine?.serial;
            if (serial === undefined || serial === null) continue;
            
            if (!grouped[serial]) {
                grouped[serial] = {
                    states: [],
                    counts: {
                        all: [],
                        valid: [],
                        misfeed: []
                    },
                    machineNames: machineNameMap
                };
            }
            
            grouped[serial].counts.all.push(count);
            
            if (count.misfeed === true) {
                grouped[serial].counts.misfeed.push(count);
            } else if (count.operator?.id !== -1) {
                grouped[serial].counts.valid.push(count);
            }
        }
    } else if (groupBy === 'operator') {
        // First, create a map of machine serials used by each operator
        const operatorMachineMap = {};
        for (const count of counts) {
            const operatorId = count.operator?.id;
            const machineSerial = count.machine?.serial;
            if (operatorId && machineSerial) {
                if (!operatorMachineMap[operatorId]) {
                    operatorMachineMap[operatorId] = new Set();
                }
                operatorMachineMap[operatorId].add(machineSerial);
            }
        }
        
        // Group counts by operator
        for (const count of counts) {
            const operatorId = count.operator?.id;
            if (operatorId === undefined || operatorId === null) continue;
            
            if (!grouped[operatorId]) {
                grouped[operatorId] = {
                    states: [],
                    counts: {
                        all: [],
                        valid: [],
                        misfeed: []
                    },
                    machineNames: machineNameMap
                };
            }
            
            grouped[operatorId].counts.all.push(count);
            
            if (count.misfeed === true) {
                grouped[operatorId].counts.misfeed.push(count);
            } else if (count.operator?.id !== -1) {
                grouped[operatorId].counts.valid.push(count);
            }
        }
        
        // Assign states to operators based on their machine usage
        for (const [operatorId, machineSerials] of Object.entries(operatorMachineMap)) {
            if (grouped[operatorId]) {
                // Filter states for machines used by this operator
                const operatorStates = states.filter(state => 
                    state.machine?.serial && machineSerials.has(state.machine.serial)
                );
                grouped[operatorId].states = operatorStates;
            }
        }
    }
    
    return grouped;
}



async function fetchGroupedAnalyticsDataForOperator(db, adjustedStart, end, operatorId) {
    const grouped = await fetchGroupedAnalyticsData(
      db,
      new Date(adjustedStart),
      new Date(end),
      'operator',
      { operatorId }
    );
  
    return grouped[operatorId] || {
      states: [],
      counts: {
        all: [],
        valid: [],
        misfeed: []
      },
      machineNames: {}
    };
  }
  
  
  async function fetchGroupedAnalyticsDataForMachine(db, start, end, machineSerial) {
    const grouped = await fetchGroupedAnalyticsData(
      db,
      new Date(start),
      new Date(end),
      'machine',
      { targetSerials: [machineSerial] }
    );
  
    return grouped[machineSerial] || {
      states: [],
      counts: {
        all: [],
        valid: [],
        misfeed: []
      },
      machineNames: {}
    };
  }


  async function fetchGroupedAnalyticsDataWithOperators(db, start, end, groupBy = 'machine', options = {}) {
    const { targetSerials = [], operatorId = null } = options;
  
    const stateQuery = {
      timestamp: { $gte: start, $lte: end },
      "machine.serial": { $type: "int" }
    };
  
    if (groupBy === 'machine' && targetSerials.length > 0) {
      stateQuery["machine.serial"] = { $in: targetSerials };
    }
  
    const countQuery = {
      timestamp: { $gte: start, $lte: end },
      "machine.serial": { $type: "int" }
    };
  
    if (groupBy === 'machine' && targetSerials.length > 0) {
      countQuery["machine.serial"] = { $in: targetSerials };
    }
  
    if (groupBy === 'operator' && operatorId !== null) {
      countQuery["operator.id"] = operatorId;
    }
  
    const [states, counts] = await Promise.all([
      db.collection("state")
        .find(stateQuery)
        .project({
          timestamp: 1,
          "machine.serial": 1,
          "machine.name": 1,
          "program.mode": 1,
          "status.code": 1,
          "status.name": 1,
          operators: 1 // ✅ properly include operator array
        })
        
        .sort({ timestamp: 1 })
        .toArray(),
  
      db.collection("count")
        .find(countQuery)
        .project({
          timestamp: 1,
          "machine.serial": 1,
          "operator.id": 1,
          "operator.name": 1,
          "item.id": 1,
          "item.name": 1,
          "item.standard": 1,
          misfeed: 1
        })
        .sort({ timestamp: 1 })
        .toArray()
    ]);
  
    const grouped = {};
    const machineNameMap = {};
  
    for (const state of states) {
      if (state.machine?.serial && state.machine?.name) {
        machineNameMap[state.machine.serial] = state.machine.name;
      }
    }
  
    if (groupBy === 'machine') {
      for (const state of states) {
        const serial = state.machine?.serial;
        if (serial == null) continue;
  
        if (!grouped[serial]) {
          grouped[serial] = {
            states: [],
            counts: { all: [], valid: [], misfeed: [] },
            machineNames: machineNameMap
          };
        }
  
        grouped[serial].states.push(state);
      }
  
      for (const count of counts) {
        const serial = count.machine?.serial;
        if (serial == null) continue;
  
        if (!grouped[serial]) {
          grouped[serial] = {
            states: [],
            counts: { all: [], valid: [], misfeed: [] },
            machineNames: machineNameMap
          };
        }
  
        grouped[serial].counts.all.push(count);
  
        if (count.misfeed === true) {
          grouped[serial].counts.misfeed.push(count);
        } else if (count.operator?.id !== -1) {
          grouped[serial].counts.valid.push(count);
        }
      }
    } else if (groupBy === 'operator') {
      const operatorMachineMap = {};
  
      for (const count of counts) {
        const operatorId = count.operator?.id;
        const machineSerial = count.machine?.serial;
        if (operatorId && machineSerial) {
          if (!operatorMachineMap[operatorId]) {
            operatorMachineMap[operatorId] = new Set();
          }
          operatorMachineMap[operatorId].add(machineSerial);
        }
      }
  
      for (const count of counts) {
        const operatorId = count.operator?.id;
        if (operatorId == null) continue;
  
        if (!grouped[operatorId]) {
          grouped[operatorId] = {
            states: [],
            counts: { all: [], valid: [], misfeed: [] },
            machineNames: machineNameMap
          };
        }
  
        grouped[operatorId].counts.all.push(count);
  
        if (count.misfeed === true) {
          grouped[operatorId].counts.misfeed.push(count);
        } else if (count.operator?.id !== -1) {
          grouped[operatorId].counts.valid.push(count);
        }
      }
  
      for (const [operatorId, machineSerials] of Object.entries(operatorMachineMap)) {
        if (grouped[operatorId]) {
          const operatorStates = states.filter(state =>
            state.machine?.serial && machineSerials.has(state.machine.serial)
          );
          grouped[operatorId].states = operatorStates;
        }
      }
    }
  
    return grouped;
  }
  
  

  
  module.exports = {
    fetchGroupedAnalyticsData,
    fetchGroupedAnalyticsDataForOperator,
    fetchGroupedAnalyticsDataForMachine,
    fetchGroupedAnalyticsDataWithOperators
  };