const { DateTime, Interval } = require("luxon");

const {
  calculateDowntime,
  calculateAvailability,
  calculateEfficiency,
  calculateOEE,
  calculateThroughput,
  calculateTotalCount,
  calculateOperatorTimes,
} = require('./analytics');


const {
  parseAndValidateQueryParams,
  createPaddedTimeRange,
  formatDuration,
  getHourlyIntervals,
  SYSTEM_TIMEZONE
} = require("./time");

const {
  extractAllCyclesFromStates,
  fetchStatesForMachine,
  getAllMachinesFromStates,
  groupStatesByOperator,
  fetchAllStates,
  groupStatesByMachine,
  getAllMachinesFromStatesForOEE,
  fetchStatesForMachineForOEE
} = require('./state');
const {
    getValidCounts,
    groupCountsByOperator,
    processCountStatistics
  } = require('./count');

  const { getBookendedStatesAndTimeRange } = require('./bookendingBuilder'); 

  const config = require('../modules/config');


async function buildMachineOEE(db, start, end) {
  try {
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);
    const totalWindowMs = new Date(paddedEnd) - new Date(paddedStart);

    // Use OEE-specific functions that handle timestamps.create
    const machines = await getAllMachinesFromStatesForOEE(db, paddedStart, paddedEnd);
    const results = [];

    for (const machine of machines) {
      const states = await fetchStatesForMachineForOEE(db, machine.serial, paddedStart, paddedEnd);
      if (!states.length) continue;

      const cycles = extractAllCyclesFromStates(states, start, end);
      const workedTimeMs = cycles.running.reduce((sum, c) => sum + c.duration, 0);
      const totalRuntime = cycles.running.reduce((sum, c) => sum + c.duration, 0) +
                         cycles.paused.reduce((sum, c) => sum + c.duration, 0) +
                         cycles.fault.reduce((sum, c) => sum + c.duration, 0);
      const oee = (workedTimeMs / totalRuntime) * 100;

      results.push({
        serial: machine.serial,
        name: states[0].machine?.name || 'Unknown',
        oee: +oee.toFixed(2)
      });
    }

    // Sort descending
    results.sort((a, b) => b.oee - a.oee);

    return results;
  } catch (error) {
    console.error('Error in buildMachineOEE:', error);
    throw error;
  }
}

async function buildDailyItemHourlyStack(db, start, end) {
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid date range provided');
    }

    const pipeline = [
      {
        $match: {
          $or: [
            { timestamp: { $gte: startDate, $lte: endDate } },
            { "timestamps.create": { $gte: startDate, $lte: endDate } }
          ],
          misfeed: { $ne: true },
          'operator.id': { $exists: true, $ne: -1 }
        }
      },
      {
        $project: {
          itemName: { $ifNull: ["$item.name", "Unknown"] },
          hour: {
            $hour: {
              date: { $ifNull: ["$timestamp", "$timestamps.create"] },
              timezone: "America/Chicago"
            }  // Use timezone-aware hour extraction, handle both timestamp formats
          }

        }
      },
      {
        $group: {
          _id: { hour: "$hour", itemName: "$itemName" },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.itemName": 1, "_id.hour": 1 } // Ensure stable order by item
      },
      {
        $group: {
          _id: "$_id.itemName",
          hourlyCounts: {
            $push: {
              hour: "$_id.hour",
              count: "$count"
            }
          }
        }
      },
      {
        $sort: { "_id": 1 } // Final sort by item name
      }
    ];

    const results = await db.collection('count').aggregate(pipeline).toArray();

    const hourSet = new Set();
    const items = {};

    for (const result of results) {
      const itemName = result._id;
      items[itemName] = {};

      for (const entry of result.hourlyCounts) {
        hourSet.add(entry.hour);
        items[itemName][entry.hour] = entry.count;
      }
    }

    const hours = Array.from(hourSet).sort((a, b) => a - b);



    const finalizedItems = {};
    const sortedItemNames = Object.keys(items).sort(); // JS-side sorting for extra safety
    for (const itemName of sortedItemNames) {
      const hourCounts = items[itemName];
      finalizedItems[itemName] = hours.map(h => hourCounts[h] || 0);
    }

    if (hours.length === 0) {
      return {
        title: "No data",
        data: { hours: [], items: {} }
      };
    }

    return {
      title: "Item Counts by Hour (All Machines)",
      data: {
        hours,
        items: finalizedItems
      }
    };

  } catch (error) {
    console.error('Error in buildDailyItemHourlyStack:', error);
    throw error;
  }
}


  async function buildTopOperatorEfficiency(db, start, end) {
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);
  
    const [counts, states] = await Promise.all([
      db.collection('count').aggregate([
        {
          $match: {
            timestamp: { $gte: paddedStart, $lte: paddedEnd },
            'operator.id': { $exists: true, $ne: -1 },
            misfeed: { $ne: true }
          }
        },
        {
          $group: {
            _id: '$operator.id',
            name: { $first: '$operator.name' },
            items: {
              $push: {
                item: '$item',
                timestamp: '$timestamp'
              }
            },
            totalCount: { $sum: 1 }
          }
        }
      ]).toArray(),
      fetchAllStates(db, paddedStart, paddedEnd)
    ]);
  
    if (!counts.length || !states.length) {
      return [];
    }
  
    const groupedStates = groupStatesByOperator(states);
    const operatorData = [];
  
    for (const count of counts) {
      const operatorId = parseInt(count._id);
      const name = count.name || 'Unknown';
      const stateGroup = groupedStates[operatorId]?.states || [];
  
      const validCounts = count.items.map(entry => ({
        item: entry.item,
        timestamp: entry.timestamp,
        misfeed: false
      }));
  
      const totalCount = validCounts.length;
      const runtime = calculateOperatorTimes(stateGroup, paddedStart, paddedEnd).runtime;
      const efficiency = calculateEfficiency(runtime, totalCount, validCounts);
  
      operatorData.push({
        id: operatorId,
        name,
        efficiency: +(efficiency * 100).toFixed(2),
        metrics: {
          runtime: {
            total: runtime,
            formatted: formatDuration(runtime)
          },
          output: {
            totalCount,
            validCount: totalCount,
            misfeedCount: 0
          }
        }
      });
    }
  
    return operatorData
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, 10);
  }


//   async function buildPlantwideMetricsByHour(db, start, end) {
//     const hourlyIntervals = getHourlyIntervals(start, end);
//     const allStates = await fetchStatesForMachine(db, null, start, end);
//     const groupedStates = groupStatesByMachine(allStates);
  
//     const results = [];
  
//     for (const { start: hourStart, end: hourEnd } of hourlyIntervals) {
//       let totalRuntime = 0;
//       let weightedAvailability = 0;
//       let weightedEfficiency = 0;
//       let weightedThroughput = 0;
//       let weightedOEE = 0;
  
//       for (const [machineSerial, group] of Object.entries(groupedStates)) {
//         const machineStates = group.states;
//         const cycles = extractAllCyclesFromStates(machineStates, hourStart, hourEnd);
//         const runningCycles = cycles.running;
  
//         // Calculate runtime within this hour
//         const runtimeMs = runningCycles.reduce((total, cycle) => {
//           const startTs = new Date(cycle.start);
//           const endTs = new Date(cycle.end);
//           const effectiveStart = startTs < hourStart ? hourStart : startTs;
//           const effectiveEnd = endTs > hourEnd ? hourEnd : endTs;
//           return total + (effectiveEnd - effectiveStart);
//         }, 0);
  
//         if (runtimeMs === 0) continue;
  
//         const machineSerialInt = parseInt(machineSerial);
//         const counts = await getValidCounts(db, machineSerialInt, hourStart, hourEnd);
//         const validCounts = counts.filter(c => !c.misfeed);
//         const misfeedCounts = counts.filter(c => c.misfeed);
  
//         const availability = runtimeMs / 3600000;
//         const throughput = validCounts.length > 0
//           ? validCounts.length / (validCounts.length + misfeedCounts.length)
//           : 0;
//         const efficiency = calculateEfficiency(runtimeMs, validCounts.length, validCounts);
//         const oee = calculateOEE(availability, efficiency, throughput);
  
//         totalRuntime += runtimeMs;
//         weightedAvailability += availability * runtimeMs;
//         weightedEfficiency += efficiency * runtimeMs;
//         weightedThroughput += throughput * runtimeMs;
//         weightedOEE += oee * runtimeMs;
//       }
  
//       results.push({
//         hour: hourStart.getHours(),
//         label: hourStart.toISOString(),
//         availability: totalRuntime ? (weightedAvailability / totalRuntime) * 100 : 0,
//         efficiency: totalRuntime ? (weightedEfficiency / totalRuntime) * 100 : 0,
//         throughput: totalRuntime ? (weightedThroughput / totalRuntime) * 100 : 0,
//         oee: totalRuntime ? (weightedOEE / totalRuntime) * 100 : 0,
//       });
//     }
  
//     return results;
//   }


async function buildPlantwideMetricsByHourOld(db, start, end) {
  const intervals = getHourlyIntervals(start, end);
  const allStates = await fetchStatesForMachine(db, null, start, end);
  const groupedStates = groupStatesByMachine(allStates);

  const hourlyMetrics = [];

  for (const interval of intervals) {
    let totalRuntime = 0;
    let weightedAvailability = 0;
    let weightedEfficiency = 0;
    let weightedThroughput = 0;
    let weightedOEE = 0;

    for (const [machineSerial, group] of Object.entries(groupedStates)) {
      const machineStates = group.states.filter(s => {
        const ts = new Date(s.timestamp);
        return ts >= interval.start && ts < interval.end;
      });

      if (!machineStates.length) continue;

      const cycles = extractAllCyclesFromStates(machineStates, interval.start, interval.end);
      const runtime = cycles.running.reduce((sum, c) => sum + c.duration, 0);
      if (!runtime) continue;

      const counts = await getValidCounts(db, parseInt(machineSerial), interval.start, interval.end);
      const validCounts = counts.filter(c => !c.misfeed);
      const misfeedCounts = counts.filter(c => c.misfeed);

      const availability = runtime / (interval.end - interval.start);
      const throughput = validCounts.length > 0
        ? validCounts.length / (validCounts.length + misfeedCounts.length)
        : 0;
      const efficiency = calculateEfficiency(runtime, validCounts.length, validCounts);
      const oee = calculateOEE(availability, efficiency, throughput);

      totalRuntime += runtime;
      weightedAvailability += availability * runtime;
      weightedEfficiency += efficiency * runtime;
      weightedThroughput += throughput * runtime;
      weightedOEE += oee * runtime;
    }

    if (totalRuntime > 0) {
      const availability = (weightedAvailability / totalRuntime) * 100;
      const efficiency = (weightedEfficiency / totalRuntime) * 100;
      const throughput = (weightedThroughput / totalRuntime) * 100;
      const oee = (weightedOEE / totalRuntime) * 100;

      // ⛔ Filter out if all metrics are 0
      if (availability === 0 && efficiency === 0 && throughput === 0 && oee === 0) {
        continue;
      }

      hourlyMetrics.push({
        hour: interval.start.getHours(),
        availability,
        efficiency,
        throughput,
        oee
      });
    }
  }

  return hourlyMetrics;
}

// buildPlantwideMetricsByHour with  machine-sessions version
async function buildPlantwideMetricsByHour(db, start, end) {
  
  const msColl = db.collection(config.machineSessionCollectionName);

  const wStart = new Date(start);
  const wEnd = new Date(end);

  // hour slots [start,end) using Luxon with SYSTEM_TIMEZONE
  const startDT = DateTime.fromJSDate(wStart, { zone: SYSTEM_TIMEZONE }).startOf("hour");
  const endDT = DateTime.fromJSDate(wEnd, { zone: SYSTEM_TIMEZONE }).endOf("hour");
  const intervals = Interval
    .fromDateTimes(startDT, endDT)
    .splitBy({ hours: 1 })
    .map(iv => ({ 
      start: iv.start.toJSDate(), 
      end: iv.end.toJSDate(),
      hourDT: iv.start // Keep Luxon DateTime for timezone-aware hour extraction
    }));

  // Get total number of active machines for plantwide availability calculation
  const totalActiveMachines = await db.collection(config.machineCollectionName)
    .countDocuments({ active: true });

  // machines that ran today (overlapped any session) - used for querying data
  // Try both machine.serial and machine.id for backward compatibility
  const serialsFromSerial = await msColl.distinct("machine.serial", {
    "timestamps.start": { $lt: wEnd },
    $or: [
      { "timestamps.end": { $gt: wStart } },
      { "timestamps.end": { $exists: false } },
      { "timestamps.end": null }
    ]
  });

  const serialsFromId = await msColl.distinct("machine.id", {
    "timestamps.start": { $lt: wEnd },
    $or: [
      { "timestamps.end": { $gt: wStart } },
      { "timestamps.end": { $exists: false } },
      { "timestamps.end": null }
    ]
  });

  // Combine and deduplicate - these are machines with sessions (used for data queries)
  const machineSerials = [...new Set([...serialsFromSerial, ...serialsFromId])].filter(Boolean);

  const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);
  const overlapFactor = (sStart, sEnd, wStart, wEnd) => {
    if (!sStart) return { factor: 0 };
    const ss = new Date(sStart);
    const se = new Date(sEnd || wEnd);
    const os = ss > wStart ? ss : wStart;
    const oe = se < wEnd ? se : wEnd;
    const ov = Math.max(0, (oe - os) / 1000);
    const full = Math.max(0, (se - ss) / 1000);
    return { factor: full > 0 ? ov / full : 0 };
  };
  const calcOEE = (a, e, t) => a * e * t;

  const hourlyMetrics = [];

  for (const iv of intervals) {
    const slotSec = (iv.end - iv.start) / 1000;

    // per-machine queries in parallel for this hour
    const machineRows = await Promise.all(machineSerials.map(async (serial) => {
      const sessions = await msColl.find({
        $and: [
          {
            $or: [
              { "machine.serial": serial },
              { "machine.id": serial }
            ]
          },
          { "timestamps.start": { $lt: iv.end } },
          {
            $or: [
              { "timestamps.end": { $gt: iv.start } },
              { "timestamps.end": { $exists: false } },
              { "timestamps.end": null }
            ]
          }
        ]
      })
      .project({
        _id: 0,
        timestamps: 1,
        runtime: 1, workTime: 1, totalTimeCredit: 1,
        totalCount: 1, misfeedCount: 1,
        'metrics.timers.run': 1, 'metrics.timers.worked': 1, 'metrics.totals.timeCredit': 1,
        'metrics.totals.counts.valid': 1, 'metrics.totals.counts.misfeed': 1
      })
      .toArray();

      if (!sessions.length) return null;

      let runtimeSec = 0, workSec = 0, creditSec = 0, valid = 0, mis = 0;

      for (const s of sessions) {
        const { factor } = overlapFactor(s.timestamps?.start, s.timestamps?.end, iv.start, iv.end);
        if (factor <= 0) continue;

        // Try new structure first (metrics), then fall back to old structure
        const runtime = s.metrics?.timers?.run || s.runtime || 0;
        const worked = s.metrics?.timers?.worked || s.workTime || 0;
        const timeCredit = s.metrics?.totals?.timeCredit || s.totalTimeCredit || 0;
        const validCount = s.metrics?.totals?.counts?.valid || s.totalCount || 0;
        const misfeedCount = s.metrics?.totals?.counts?.misfeed || s.misfeedCount || 0;

        runtimeSec += safe(runtime)      * factor;
        workSec    += safe(worked)       * factor;
        creditSec  += safe(timeCredit)   * factor;
        valid      += safe(validCount)   * factor;
        mis        += safe(misfeedCount) * factor;
      }

      if (runtimeSec <= 0 && workSec <= 0 && (valid + mis) <= 0) return null;

      const availability = slotSec > 0 ? (runtimeSec / slotSec) : 0;
      const efficiency   = workSec  > 0 ? (creditSec / workSec) : 0;
      const throughput   = (valid + mis) > 0 ? (valid / (valid + mis)) : 0;
      const oee          = calcOEE(availability, efficiency, throughput);

      return { runtimeSec, availability, efficiency, throughput, oee };
    }));

    // aggregate plantwide (runtime-weighted)
    let totalRuntime = 0, wAvail = 0, wEff = 0, wThru = 0, wOee = 0;

    for (const r of machineRows) {
      if (!r) continue;
      totalRuntime += r.runtimeSec;
      wAvail += r.availability * r.runtimeSec;
      wEff   += r.efficiency   * r.runtimeSec;
      wThru  += r.throughput   * r.runtimeSec;
      wOee   += r.oee          * r.runtimeSec;
    }

    // Extract hour in SYSTEM_TIMEZONE
    const hourInTimezone = iv.hourDT.hour; // Use Luxon DateTime to get hour in correct timezone

    // Calculate metrics - include all hours, even if no runtime
    let availability, efficiency, throughput, oee;
    
    // Calculate plantwide availability: total runtime / (total active machines * hour duration)
    // Use totalActiveMachines instead of machineSerials.length to include all active machines,
    // not just those with sessions in the time range
    const totalPossibleSec = totalActiveMachines * slotSec;
    availability = totalPossibleSec > 0 ? (totalRuntime / totalPossibleSec) * 100 : 0;
    
    // Calculate efficiency from aggregated work time and time credit
    efficiency = totalWorkSec > 0 ? (totalCreditSec / totalWorkSec) * 100 : 0;
    
    // Calculate throughput from aggregated counts
    throughput = (totalValid + totalMis) > 0 ? (totalValid / (totalValid + totalMis)) * 100 : 0;
    
    // Calculate OEE = Availability * Efficiency * Throughput (all as ratios 0-1)
    const availRatio = availability / 100;
    const effRatio = efficiency / 100;
    const thruRatio = throughput / 100;
    oee = +( (availRatio * effRatio * thruRatio) * 100 ).toFixed(2);
    
    // Round values
    availability = +(availability.toFixed(2));
    efficiency = +(efficiency.toFixed(2));
    throughput = +(throughput.toFixed(2));

    // Include all hours in the range, even if metrics are all zero
    hourlyMetrics.push({
      hour: hourInTimezone,
      availability,
      efficiency,
      throughput,
      oee
    });
  }

  return hourlyMetrics;
}

// buildPlantwideMetricsByHour from hourly-totals cache
async function buildPlantwideMetricsByHourFromCache(db, start, end) {
  const wStart = new Date(start);
  const wEnd = new Date(end);

  // hour slots [start,end) using Luxon with SYSTEM_TIMEZONE
  const startDT = DateTime.fromJSDate(wStart, { zone: SYSTEM_TIMEZONE }).startOf("hour");
  const endDT = DateTime.fromJSDate(wEnd, { zone: SYSTEM_TIMEZONE }).endOf("hour");
  const intervals = Interval
    .fromDateTimes(startDT, endDT)
    .splitBy({ hours: 1 })
    .map(iv => ({ 
      start: iv.start.toJSDate(), 
      end: iv.end.toJSDate(),
      hourDT: iv.start // Keep Luxon DateTime for timezone-aware hour extraction
    }));

  // Get total number of active machines for plantwide availability calculation
  const totalActiveMachines = await db.collection(config.machineCollectionName)
    .countDocuments({ active: true });

  // Get date strings and hour ranges for the time range
  const startDateStr = startDT.toFormat('yyyy-LL-dd');
  const endDateStr = endDT.toFormat('yyyy-LL-dd');
  const dateStrs = [];
  let currentDate = startDT.startOf('day');
  const endDate = endDT.startOf('day');
  while (currentDate <= endDate) {
    dateStrs.push(currentDate.toFormat('yyyy-LL-dd'));
    currentDate = currentDate.plus({ days: 1 });
  }

  // Query all machine hourly records from hourly-totals for the date range
  const machineHourlyRecords = await db.collection('hourly-totals')
    .find({
      entityType: 'machine',
      date: { $in: dateStrs }
    })
    .toArray();

  if (machineHourlyRecords.length === 0) {
    // Return empty metrics for all hours
    return intervals.map(iv => ({
      hour: iv.hourDT.hour,
      availability: 0,
      efficiency: 0,
      throughput: 0,
      oee: 0
    }));
  }

  const safe = n => (typeof n === "number" && isFinite(n) ? n : 0);

  // Group records by date-hour combination and aggregate across all machines
  const hourlyDataMap = new Map();

  // Initialize all intervals (date-hour combinations)
  for (const iv of intervals) {
    const dateStr = iv.hourDT.toFormat('yyyy-LL-dd');
    const hour = iv.hourDT.hour;
    const key = `${dateStr}-${hour}`;
    hourlyDataMap.set(key, {
      hour,
      totalRuntimeMs: 0,
      totalWorkedTimeMs: 0,
      totalTimeCreditMs: 0,
      totalCounts: 0,
      totalMisfeeds: 0,
      machineCount: 0
    });
  }

  // Aggregate metrics by date-hour from hourly records
  for (const record of machineHourlyRecords) {
    const key = `${record.date}-${record.hour}`;
    if (!hourlyDataMap.has(key)) {
      // Skip hours outside the requested range
      continue;
    }

    const hourData = hourlyDataMap.get(key);
    hourData.totalRuntimeMs += safe(record.runtimeMs || 0);
    hourData.totalWorkedTimeMs += safe(record.workedTimeMs || 0);
    hourData.totalTimeCreditMs += safe(record.totalTimeCreditMs || 0);
    hourData.totalCounts += safe(record.totalCounts || 0);
    hourData.totalMisfeeds += safe(record.totalMisfeeds || 0);
    hourData.machineCount += 1;
  }

  // Calculate plantwide metrics for each hour
  const hourlyMetrics = [];
  const hourSlotSec = 3600; // 1 hour in seconds

  for (const iv of intervals) {
    const dateStr = iv.hourDT.toFormat('yyyy-LL-dd');
    const hour = iv.hourDT.hour;
    const key = `${dateStr}-${hour}`;
    const hourData = hourlyDataMap.get(key);

    if (!hourData || hourData.machineCount === 0) {
      // No data for this hour
      hourlyMetrics.push({
        hour,
        availability: 0,
        efficiency: 0,
        throughput: 0,
        oee: 0
      });
      continue;
    }

    // Calculate plantwide availability: total runtime / (total active machines * hour duration)
    // This gives us the percentage of machines that were running during this hour
    const totalPossibleRuntimeMs = totalActiveMachines * hourSlotSec * 1000;
    const availability = totalPossibleRuntimeMs > 0 
      ? (hourData.totalRuntimeMs / totalPossibleRuntimeMs) * 100 
      : 0;

    // Calculate efficiency: total time credit / total worked time
    const totalWorkedTimeSec = hourData.totalWorkedTimeMs / 1000;
    const totalTimeCreditSec = hourData.totalTimeCreditMs / 1000;
    const efficiency = totalWorkedTimeSec > 0 
      ? (totalTimeCreditSec / totalWorkedTimeSec) * 100 
      : 0;

    // Calculate throughput: valid counts / total counts
    const totalOutput = hourData.totalCounts + hourData.totalMisfeeds;
    const throughput = totalOutput > 0 
      ? (hourData.totalCounts / totalOutput) * 100 
      : 0;

    // Calculate OEE = Availability * Efficiency * Throughput (all as ratios 0-1)
    const availRatio = availability / 100;
    const effRatio = efficiency / 100;
    const thruRatio = throughput / 100;
    const oee = +((availRatio * effRatio * thruRatio) * 100).toFixed(2);

    hourlyMetrics.push({
      hour,
      availability: +(availability.toFixed(2)),
      efficiency: +(efficiency.toFixed(2)),
      throughput: +(throughput.toFixed(2)),
      oee
    });
  }

  return hourlyMetrics;
}

  async function buildDailyMachineStatus(db, start, end) {
    const { paddedStart, paddedEnd } = createPaddedTimeRange(start, end);
    const machines = await getAllMachinesFromStates(db, paddedStart, paddedEnd);
    const results = [];
  
    for (const machine of machines) {
      const states = await fetchStatesForMachine(db, machine.serial, paddedStart, paddedEnd);
      if (!states.length) continue;
  
      const cycles = extractAllCyclesFromStates(states, start, end);
      results.push({
        serial: machine.serial,
        name: states[0].machine?.name || "Unknown",
        runningMs: cycles.running.reduce((sum, c) => sum + c.duration, 0),
        pausedMs: cycles.paused.reduce((sum, c) => sum + c.duration, 0),
        faultedMs: cycles.fault.reduce((sum, c) => sum + c.duration, 0)
      });
    }
  
    return results;
  }
  

  
  async function buildDailyCountTotals(db, _start, end) {
    try {
      const endDate = new Date(end);
      const startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 27); // include 28 total days including endDate
      startDate.setHours(0, 0, 0, 0); // set to 12:00 AM
  
      const pipeline = [
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate },
            misfeed: { $ne: true },
            'operator.id': { $exists: true, $ne: -1 }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: "$timestamp" },
              month: { $month: "$timestamp" },
              day: { $dayOfMonth: "$timestamp" }
            },
            count: { $sum: 1 },
            date: { $first: "$timestamp" }
          }
        },
        {
          $project: {
            _id: 0,
            date: {
              $dateFromParts: {
                year: "$_id.year",
                month: "$_id.month",
                day: "$_id.day"
              }
            },
            count: 1
          }
        },
        {
          $sort: { date: 1 }
        }
      ];
  
      const results = await db.collection('count').aggregate(pipeline).toArray();
  
      return results.map(entry => ({
        date: entry.date.toISOString().split('T')[0],
        count: entry.count
      }));
  
    } catch (error) {
      console.error('Error in buildDailyCountTotals:', error);
      throw error;
    }
  }
  

module.exports = {
  buildMachineOEE,
  buildDailyItemHourlyStack,
  buildTopOperatorEfficiency,
  buildPlantwideMetricsByHour,
  buildPlantwideMetricsByHourFromCache,
  buildDailyMachineStatus,
  buildDailyCountTotals
};