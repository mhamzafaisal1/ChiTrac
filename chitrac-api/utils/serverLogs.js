/**
 * Utility functions for querying server logs from the logging database
 */

/**
 * Fetch logs from the api-http collection
 * @param {Object} logDb - The logging database connection
 * @param {Object} options - Query options
 * @param {Date} options.start - Start date for filtering
 * @param {Date} options.end - End date for filtering
 * @param {string} options.level - Filter by log level (optional)
 * @param {number} options.limit - Maximum number of records to return
 * @param {number} options.skip - Number of records to skip for pagination
 * @returns {Promise<Array>} Array of log entries
 */
async function fetchServerLogs(logDb, options = {}) {
  const {
    start,
    end,
    level,
    limit = 100,
    skip = 0
  } = options;

  try {
    const collection = logDb.collection('api-http');
    
    // Build query
    const query = {};
    
    // Date range filter
    if (start || end) {
      query.timestamp = {};
      if (start) {
        query.timestamp.$gte = new Date(start);
      }
      if (end) {
        query.timestamp.$lte = new Date(end);
      }
    }
    
    // Level filter
    if (level) {
      query.level = level;
    }
    
    // Execute query
    const logs = await collection
      .find(query)
      .sort({ timestamp: -1 }) // Most recent first
      .skip(skip)
      .limit(limit)
      .toArray();
    
    // Format logs for frontend
    return logs.map(log => ({
      _id: log._id,
      timestamp: log.timestamp,
      level: log.level || 'unknown',
      message: log.message || '',
      meta: log.meta,
      hostname: log.hostname || 'unknown'
    }));
  } catch (error) {
    throw new Error(`Failed to fetch server logs: ${error.message}`);
  }
}

/**
 * Get total count of logs matching the query (for pagination)
 * @param {Object} logDb - The logging database connection
 * @param {Object} options - Query options (same as fetchServerLogs)
 * @returns {Promise<number>} Total count of matching logs
 */
async function getServerLogsCount(logDb, options = {}) {
  const {
    start,
    end,
    level
  } = options;

  try {
    const collection = logDb.collection('api-http');
    
    // Build query (same as fetchServerLogs)
    const query = {};
    
    if (start || end) {
      query.timestamp = {};
      if (start) {
        query.timestamp.$gte = new Date(start);
      }
      if (end) {
        query.timestamp.$lte = new Date(end);
      }
    }
    
    if (level) {
      query.level = level;
    }
    
    return await collection.countDocuments(query);
  } catch (error) {
    throw new Error(`Failed to count server logs: ${error.message}`);
  }
}

module.exports = {
  fetchServerLogs,
  getServerLogsCount
};

