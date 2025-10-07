const { getCountCollectionName } = require('./time');

async function getCountRecords(db, serial, start, end) {
    const countCollection = getCountCollectionName(start);
    return db.collection(countCollection)
      .find({
        'machine.serial': serial,
        timestamp: { $gte: new Date(start), $lte: new Date(end) },
        'operator.id': { $exists: true, $ne: -1 }
      })
      .sort({ timestamp: 1 })
      .toArray();
  }
  async function getValidCounts(db, serial, start, end) {
    const query = {
      timestamp: { $gte: new Date(start), $lte: new Date(end) },
      'operator.id': { $exists: true, $ne: -1 },
      misfeed: { $ne: true }
    };
  
    if (serial !== null && serial !== undefined) {
      query['machine.serial'] = serial;
    }
  
    const countCollection = getCountCollectionName(start);
    return db.collection(countCollection)
      .find(query)
      .sort({ timestamp: 1 })
      .toArray();
  }
  
  
  async function getMisfeedCounts(db, serial, start, end) {
    const countCollection = getCountCollectionName(start);
    return db.collection(countCollection)
      .find({
        'machine.serial': serial,
        timestamp: { $gte: new Date(start), $lte: new Date(end) },
        'operator.id': { $exists: true, $ne: -1 },
        misfeed: true // Only misfeeds
      })
      .sort({ timestamp: 1 })
      .toArray();
  }
  
  
  function getOperatorItemMapFromCounts(countRecords) {
    const operatorMap = {};
  
    for (const record of countRecords) {
      const operatorId = record.operator?.id;
      const operatorName = record.operator?.name;
      const item = record.item;
  
      if (!operatorId || operatorId === -1 || !item) continue;
  
      if (!operatorMap[operatorId]) {
        operatorMap[operatorId] = {
          name: operatorName || 'Unknown',
          items: {}
        };
      }
  
      const itemIdKey = item?.id ?? 'unknown';
      if (!operatorMap[operatorId].items[itemIdKey]) {
        operatorMap[operatorId].items[itemIdKey] = [];
      }
  
      operatorMap[operatorId].items[itemIdKey].push(item);
    }
  
    for (const opId of Object.keys(operatorMap)) {
      if (!operatorMap[opId].name || operatorMap[opId].name === 'Unknown') {
        const match = countRecords.find(rec => rec.operator?.id === parseInt(opId) && rec.operator?.name);
        if (match) {
          operatorMap[opId].name = match.operator.name;
        }
      }
    }
  
    return operatorMap;
  }

  // Count functions for Operator

  // Operator-specific count functions
  async function getValidCountsForOperator(db, operatorId, start, end) {
    const countCollection = getCountCollectionName(start);
    return db.collection(countCollection)
      .find({
        'operator.id': operatorId,
        timestamp: { $gte: new Date(start), $lte: new Date(end) },
        misfeed: { $ne: true } // Exclude misfeeds
      })
      .sort({ timestamp: 1 })
      .toArray();
  }

  async function getMisfeedCountsForOperator(db, operatorId, start, end) {
    const countCollection = getCountCollectionName(start);
    return db.collection(countCollection)
      .find({
        'operator.id': operatorId,
        timestamp: { $gte: new Date(start), $lte: new Date(end) },
        misfeed: true // Only misfeeds
      })
      .sort({ timestamp: 1 })
      .toArray();
  }

  /**
   * Gets the operator name from the count collection based on operator ID
   * @param {Object} db - MongoDB database instance
   * @param {number} operatorId - Operator ID to look up
   * @returns {Promise<string>} Operator name or 'Unknown' if not found
   */
  async function getOperatorNameFromCount(db, operatorId) {
    if (!operatorId) return 'Unknown';
    
    try {
      // Convert operatorId to number if it's a string
      const numericOperatorId = typeof operatorId === 'string' ? parseInt(operatorId, 10) : operatorId;
      
      // For this function, we need to use a default collection since we don't have a start time
      // We'll use the base collection for now
      const count = await db.collection('count')
        .findOne(
          { 'operator.id': numericOperatorId },
          { projection: { 'operator.name': 1 } }
        );
        
      if (!count || !count.operator || !count.operator.name) {
        console.log(`No operator name found for ID: ${numericOperatorId}`);
        return 'Unknown';
      }
      
      return count.operator.name;
    } catch (error) {
      console.error('Error getting operator name:', error);
      return 'Unknown';
    }
  }

  async function getCountsForOperator(db, operatorId, start, end) {
    const countCollection = getCountCollectionName(start);
    return db.collection(countCollection)
      .find({
        'operator.id': operatorId,
        timestamp: { $gte: new Date(start), $lte: new Date(end) }
      })
      .sort({ timestamp: 1 })
      .toArray();
  }

  function extractItemNamesFromCounts(counts) {
    const itemNames = new Set();
    for (const count of counts) {
      const item = count.item;
      if (item && item.name) {
        itemNames.add(item.name);
      }
    }
    return Array.from(itemNames).join(', ');
  }

  //Module functions for accessing count collection
    
  /**
   * Gets counts for multiple operator-machine pairs in a single query
   * @param {Object} db - MongoDB database instance
   * @param {Array} pairs - Array of {operatorId, machineSerial} objects
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @returns {Promise<Array>} Array of count records
   */
  async function getCountsForOperatorMachinePairs(db, pairs, start, end) {
    if (!pairs.length) return [];
    
    const query = {
      $or: pairs.map(pair => ({
        'operator.id': pair.operatorId,
        'machine.serial': pair.machineSerial
      })),
      timestamp: { $gte: new Date(start), $lte: new Date(end) }
    };

    const countCollection = getCountCollectionName(start);
    return db.collection(countCollection)
      .find(query)
      .sort({ timestamp: 1 })
      .toArray();
  }

  
  async function getCountsForMachineStationPairs(db, pairs, start, end) {
    if (!pairs.length) return [];
  
    const query = {
      $or: pairs.map(pair => ({
        'machine.serial': pair.machineSerial,
        'station': pair.station // ✅ fixed path
      })),
      timestamp: { $gte: new Date(start), $lte: new Date(end) }
    };
  
    const countCollection = getCountCollectionName(start);
    const collectionExists = await db.listCollections({ name: countCollection }).hasNext();
    const collection = collectionExists ? countCollection : 'count';
    
    console.log('Count collection:', collection, 'Exists:', collectionExists);
    
    return db.collection(collection)
      .find(query)
      .sort({ timestamp: 1 })
      .toArray();
  }

  async function getCountsForMachineStationPairsForSoftrol(db, pairs, start, end) {
    if (!pairs.length) return [];
  
    const query = {
      $or: pairs.map(pair => ({
        'machine.serial': pair.machineSerial,
        'station': pair.station
      })),
      timestamp: { $gte: new Date(start), $lte: new Date(end) }
    };
  
    console.log('Querying count collection between', start, 'and', end);
    
    return db.collection('count')
      .find(query)
      .sort({ timestamp: 1 })
      .toArray();
  }
  
  

  /**
   * Gets counts for a specific machine with optional operator filter
   * @param {Object} db - MongoDB database instance
   * @param {number} machineSerial - Machine serial number
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {number} [operatorId] - Optional operator ID
   * @returns {Promise<Array>} Array of count records
   */
  async function getCountsForMachine(db, machineSerial, start, end, operatorId = null) {
    const query = {
      'machine.serial': machineSerial,
      timestamp: { $gte: new Date(start), $lte: new Date(end) }
    };

    if (operatorId) {
      query['operator.id'] = operatorId;
    }

    const countCollection = getCountCollectionName(start);
    return db.collection(countCollection)
      .find(query)
      .sort({ timestamp: 1 })
      .toArray();
  }

  /**
   * Processes counts to calculate totals and statistics
   * @param {Array} counts - Array of count records
   * @returns {Object} Processed count statistics
   */
  function processCountStatistics(counts) {
    const validCounts = counts.filter(count => !count.misfeed);
    const misfeedCounts = counts.filter(count => count.misfeed);
    
    const itemMap = {};
    const operatorMap = {};
    
    for (const count of counts) {
      // Process items
      if (count.item) {
        const itemKey = `${count.item.id}-${count.item.name}`;
        if (!itemMap[itemKey]) {
          itemMap[itemKey] = {
            id: count.item.id,
            name: count.item.name,
            standard: count.item.standard,
            count: 0
          };
        }
        itemMap[itemKey].count++;
      }
      
      // Process operators
      if (count.operator) {
        const opId = count.operator.id;
        if (!operatorMap[opId]) {
          operatorMap[opId] = {
            id: opId,
            name: count.operator.name,
            count: 0
          };
        }
        operatorMap[opId].count++;
      }
    }

    return {
      total: counts.length,
      valid: validCounts.length,
      misfeeds: misfeedCounts.length,
      items: Object.values(itemMap),
      operators: Object.values(operatorMap)
    };
  }

  /**
   * Gets counts grouped by operator and machine
   * @param {Array} counts - Array of count records
   * @returns {Object} Counts grouped by operator and machine
   */
  function groupCountsByOperatorAndMachine(counts) {
    const grouped = {};
    
    for (const count of counts) {
      const opId = count.operator?.id;
      const machineSerial = count.machine?.serial;
      
      if (!opId || !machineSerial) continue;
      
      const key = `${opId}-${machineSerial}`;
      if (!grouped[key]) {
        grouped[key] = {
          operator: count.operator,
          machine: count.machine,
          counts: [],
          validCounts: [],
          misfeedCounts: []
        };
      }
      
      grouped[key].counts.push(count);
      if (count.misfeed) {
        grouped[key].misfeedCounts.push(count);
      } else {
        grouped[key].validCounts.push(count);
      }
    }
    
    return grouped;
  }
  function groupCountsByMachineAndStation(counts) {
    const grouped = {};
  
    for (const count of counts) {
      const machineSerial = count.machine?.serial;
      const station = count.station; // ✅ FIXED
  
      if (!machineSerial || station === undefined || station === null) continue;
  
      const key = `${machineSerial}-${station}`;
  
      if (!grouped[key]) {
        grouped[key] = {
          operator: count.operator,
          machine: count.machine,
          counts: [],
          validCounts: [],
          misfeedCounts: [],
        };
      }
  
      grouped[key].counts.push(count);
      if (count.misfeed) {
        grouped[key].misfeedCounts.push(count);
      } else {
        grouped[key].validCounts.push(count);
      }
    }
  
    return grouped;
  }
  

  function groupCountsByItem(counts) {
    const grouped = {};
    for (const count of counts) {
      const itemId = count.item?.id;
      if (itemId == null) continue;
      if (!grouped[itemId]) grouped[itemId] = [];
      grouped[itemId].push(count);
    }
    return grouped;
  }

  async function getCountsForMachine(db, machineSerial, start, end, operatorId = null) {
    const query = {
      'machine.serial': machineSerial,
      timestamp: { $gte: new Date(start), $lte: new Date(end) }
    };
  
    if (operatorId) {
      query['operator.id'] = operatorId;
    }
  
    return db.collection('count')
      .find(query)
      .sort({ timestamp: 1 })
      .toArray();
  }
  

  function groupCountsByOperatorAndMachine(counts) {
    const grouped = {};
  
    for (const count of counts) {
      const opId = count.operator?.id;
      const machineSerial = count.machine?.serial;
  
      if (!opId || opId === -1 || !machineSerial) continue;
  
      const key = `${opId}-${machineSerial}`;
  
      if (!grouped[key]) {
        grouped[key] = {
          operator: count.operator,
          machine: count.machine,
          counts: [],
          validCounts: [],
          misfeedCounts: []
        };
      }
  
      grouped[key].counts.push(count);
  
      if (count.misfeed) {
        grouped[key].misfeedCounts.push(count);
      } else {
        grouped[key].validCounts.push(count);
      }
    }
  
    return grouped;
  }

  function groupCountsByOperator(counts) {
    const grouped = {};
    for (const count of counts) {
      const opId = count.operator?.id;
      if (!opId || opId === -1) continue;
      if (!grouped[opId]) grouped[opId] = [];
      grouped[opId].push(count);
    }
    return grouped;
  }
  
  
  

  module.exports = {
    getCountRecords,
    getValidCounts,
    getMisfeedCounts,
    getOperatorItemMapFromCounts,
    getValidCountsForOperator,
    getMisfeedCountsForOperator,
    getOperatorNameFromCount,
    getCountsForOperator,
    extractItemNamesFromCounts,
    getCountsForOperatorMachinePairs,
    getCountsForMachine,
    processCountStatistics,
    groupCountsByItem,
    getCountsForMachine,
    groupCountsByOperatorAndMachine,
    groupCountsByOperator,
    getCountsForMachineStationPairs,
    getCountsForMachineStationPairsForSoftrol,
    groupCountsByMachineAndStation
  };
  