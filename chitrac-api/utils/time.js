const { DateTime, Duration } = require("luxon");

const SYSTEM_TIMEZONE = "America/Chicago";

const TIME_CONSTANTS = {
  MINUTES_IN_HOUR: 60,
  MILLISECONDS_IN_MINUTE: 60000,
  MILLISECONDS_IN_HOUR: 3600000,
  DEFAULT_PADDING: 5,
  DATE_FORMATS: {
    ISO: "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
    DISPLAY: "MM/dd/yyyy HH:mm:ss",
    MONGO: "YYYY-MM-DDTHH:mm:ss.SSSZ",
  },
  // Collection selection thresholds (in hours)
  COLLECTION_THRESHOLDS: {
    DAILY: 24,      // < 24h → *-daily
    WEEKLY: 168,    // >= 24h && < 168h → *-weekly  
    MONTHLY: 744,   // >= 168h && < 744h → *-monthly
  },
};

/**
 * Validates and parses query parameters for MongoDB date queries
 */
function parseAndValidateQueryParams(req) {
  const {
    startTime,
    endTime,
    machineSerial,
    start,
    end,
    serial,
    operatorId,
    timeframe,
  } = req.query;

  const machineId = machineSerial || serial;

  let startDT, endDT;

  if (timeframe) {
    ({ startDT, endDT } = resolveTimeframe(timeframe));
  } else {
    const startDate = startTime || start;
    const endDate = endTime || end;
    if (!startDate || !endDate) {
      throw new Error("start/startTime and end/endTime are required when 'timeframe' is not provided");
    }
    startDT = validateDateString(startDate);
    endDT = validateDateString(endDate);
  }

  // Clamp end to now to avoid future ranges
  const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
  if (endDT > now) endDT = now;

  validateTimeRange(startDT, endDT);

  return {
    start: convertToMongoDate(startDT),
    end: convertToMongoDate(endDT),
    serial: machineId ? (parseInt(machineId, 10) || null) : null,
    operatorId: operatorId ? (parseInt(operatorId, 10) || null) : null,
    startLuxon: startDT,
    endLuxon: endDT,
    timeframe: timeframe || null,
  };
}

/**
 * Resolves timeframe values to start and end DateTime objects
 * @param {string} tf - The timeframe value
 * @returns {Object} Object containing startDT and endDT Luxon DateTime objects
 */
function resolveTimeframe(tf) {
  const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
  let startDT, endDT = now;

  switch (tf) {
    case 'current':
      startDT = now.minus({ minutes: 6 });
      break;
    case 'lastFifteen':
      startDT = now.minus({ minutes: 15 });
      break;
    case 'lastHour':
      startDT = now.minus({ hours: 1 });
      break;
    case 'today':
      startDT = now.startOf('day');
      break;
    case 'thisWeek':
      startDT = now.startOf('week');
      break;
    case 'thisMonth':
      startDT = now.startOf('month');
      break;
    case 'thisYear':
      startDT = now.startOf('year');
      break;
    default:
      throw new Error(`Unsupported timeframe '${tf}'`);
  }
  return { startDT, endDT };
}

/**
 * Creates a padded time range for MongoDB queries
 */
function createPaddedTimeRange(start, end, paddingMinutes = TIME_CONSTANTS.DEFAULT_PADDING) {
  const startDT = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE });
  const endDT = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE });

  return {
    paddedStart: convertToMongoDate(startDT.minus({ minutes: paddingMinutes })),
    paddedEnd: convertToMongoDate(endDT.plus({ minutes: paddingMinutes })),
  };
}

/**
 * Validates that start time is before end time
 */
function validateTimeRange(start, end) {
  if (start > end) {
    throw new Error("Start time must be before end time");
  }
  return true;
}

/**
 * Validates a date string and converts it to a Luxon DateTime
 */
function validateDateString(dateString) {
  const dt = DateTime.fromISO(dateString, { zone: SYSTEM_TIMEZONE });
  if (!dt.isValid) {
    throw new Error("Invalid date string format");
  }
  return dt;
}

/**
 * Converts Luxon DateTime to Mongo-compatible JS Date
 */
function convertToMongoDate(dt) {
  return dt.toJSDate();
}

/**
 * Creates a MongoDB date query object
 */
function createMongoDateQuery(start, end) {
  return {
    $gte: convertToMongoDate(DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE })),
    $lte: convertToMongoDate(DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE })),
  };
}

/**
 * Calculates duration between two dates in milliseconds
 */
function calculateDuration(start, end) {
  const startDT = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE });
  const endDT = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE });
  return endDT.diff(startDT).as("milliseconds");
}

/**
 * Formats duration into hours and minutes
 */
function formatDuration(milliseconds) {
  if (isNaN(milliseconds)) {
    return {hours:0, minutes: 0}
  } else {
    const dur = Duration.fromMillis(milliseconds);
    const hours = Math.floor(dur.as("hours"));
    const minutes = Math.floor(dur.minus({ hours }).as("minutes"));
    return { hours, minutes };
  }
}

/**
 * Creates a MongoDB aggregation pipeline for time-based grouping
 */
function createTimeGroupingPipeline(dateField, interval = "hour") {
  return [
    {
      $group: {
        _id: {
          $dateToString: {
            format: getMongoDateFormat(interval),
            date: `$${dateField}`,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ];
}

/**
 * Gets MongoDB date format string based on interval
 */
function getMongoDateFormat(interval) {
  const formats = {
    hour: "%Y-%m-%d %H:00:00",
    day: "%Y-%m-%d",
    month: "%Y-%m",
    year: "%Y",
  };
  return formats[interval] || formats.hour;
}

/**
 * Generates hourly intervals between two timestamps
 */
function getHourlyIntervals(start, end) {
  const startDT = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE }).startOf("hour");
  const endDT = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE }).endOf("hour");

  const intervals = [];
  let cursor = startDT;

  while (cursor < endDT) {
    const next = cursor.plus({ hours: 1 });
    intervals.push({
      start: cursor.toJSDate(),
      end: next > endDT ? endDT.toJSDate() : next.toJSDate(),
    });
    cursor = next;
  }

  return intervals;
}

/**
 * Enforces a minimum time window of N days
 */
function enforceMinimumTimeRange(start, end, minDays = 7) {
  let startDT = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE });
  const endDT = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE });
  const minDuration = Duration.fromObject({ days: minDays });

  if (endDT.diff(startDT) < minDuration) {
    startDT = endDT.minus(minDuration);
  }

  return {
    start: startDT.toISO(),
    end: endDT.toISO(),
  };
}

/**
 * Generates day-by-day intervals between two timestamps
 */
function getDayIntervals(start, end) {
  const startDT = DateTime.fromJSDate(start, { zone: SYSTEM_TIMEZONE }).startOf("day");
  const endDT = DateTime.fromJSDate(end, { zone: SYSTEM_TIMEZONE }).endOf("day");

  const intervals = [];
  let cursor = startDT;

  while (cursor < endDT) {
    const next = cursor.plus({ days: 1 });
    intervals.push({
      start: cursor.toJSDate(),
      end: next.toJSDate(),
    });
    cursor = next;
  }

  return intervals;
}

/**
 * Safely converts input to Luxon DateTime, handling both strings and Date objects
 * @param {Date|string} input - Date object or ISO string
 * @returns {DateTime} Luxon DateTime object
 * @throws {Error} If input is invalid
 */
function safeToDateTime(input) {
  let dt;
  
  if (input instanceof Date) {
    dt = DateTime.fromJSDate(input, { zone: SYSTEM_TIMEZONE });
  } else if (typeof input === 'string') {
    dt = DateTime.fromISO(input, { zone: SYSTEM_TIMEZONE });
  } else {
    throw new Error('Input must be a Date object or ISO string');
  }
  
  if (!dt.isValid) {
    throw new Error(`Invalid date: ${dt.invalidReason} - ${dt.invalidExplanation}`);
  }
  
  return dt;
}

/**
 * Determines which state collection to query based on start date
 * @param {Date|string} startDate - The start date for the query
 * @returns {string} The appropriate collection name
 */
function getStateCollectionName(startDate) {
  const startDT = safeToDateTime(startDate);
  const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
  const hoursDiff = now.diff(startDT).as('hours');
  
  // Handle future timestamps - treat as daily
  if (hoursDiff < 0) {
    return 'state-machine-daily';
  }
  
  const { DAILY, WEEKLY, MONTHLY } = TIME_CONSTANTS.COLLECTION_THRESHOLDS;
  
  if (hoursDiff < DAILY) {
    return 'state-machine-daily';
  } else if (hoursDiff >= DAILY && hoursDiff < WEEKLY) {
    return 'state-machine-weekly';
  } else if (hoursDiff >= WEEKLY && hoursDiff < MONTHLY) {
    return 'state-machine-monthly';
  } else {
    return 'state-machine'; // Base collection for older data
  }
}

/**
 * Determines which count collection to query based on start date
 * @param {Date|string} startDate - The start date for the query
 * @returns {string} The appropriate collection name
 */
function getCountCollectionName(startDate) {
  const startDT = safeToDateTime(startDate);
  const now = DateTime.now().setZone(SYSTEM_TIMEZONE);
  const hoursDiff = now.diff(startDT).as('hours');
  
  // Handle future timestamps - treat as daily
  if (hoursDiff < 0) {
    return 'count-daily';
  }
  
  const { DAILY, WEEKLY, MONTHLY } = TIME_CONSTANTS.COLLECTION_THRESHOLDS;
  
  if (hoursDiff < DAILY) {
    return 'count-daily';
  } else if (hoursDiff >= DAILY && hoursDiff < WEEKLY) {
    return 'count-weekly';
  } else if (hoursDiff >= WEEKLY && hoursDiff < MONTHLY) {
    return 'count-monthly';
  } else {
    return 'count'; // Base collection for older data
  }
}

/**
 * Gets the appropriate collection names for both state and count based on start date
 * @param {Date|string} startDate - The start date for the query
 * @returns {Object} Object containing state and count collection names
 */
function getCollectionNames(startDate) {
  return {
    stateCollection: getStateCollectionName(startDate),
    countCollection: getCountCollectionName(startDate)
  };
}

/**
 * Resolves legacy collection names to new collection names
 * @param {string} collectionName - The collection name to resolve
 * @param {Date|string} startDate - The start date for the query (optional, for time-based resolution)
 * @returns {string} The resolved collection name
 */
function resolveCollectionName(collectionName, startDate = null) {
  // Handle legacy collection names
  if (collectionName === 'state') {
    return startDate ? getStateCollectionName(startDate) : 'state-machine';
  }
  
  if (collectionName === 'count' && startDate) {
    return getCountCollectionName(startDate);
  }
  
  return collectionName;
}

module.exports = {
  TIME_CONSTANTS,
  SYSTEM_TIMEZONE,
  parseAndValidateQueryParams,
  resolveTimeframe,
  createPaddedTimeRange,
  validateTimeRange,
  validateDateString,
  convertToMongoDate,
  createMongoDateQuery,
  calculateDuration,
  formatDuration,
  createTimeGroupingPipeline,
  getMongoDateFormat,
  getHourlyIntervals,
  enforceMinimumTimeRange,
  getDayIntervals,
  getStateCollectionName,
  getCountCollectionName,
  getCollectionNames,
  resolveCollectionName,
};
