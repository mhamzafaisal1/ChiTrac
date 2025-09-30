require('dotenv').config();

module.exports = {
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT, 10) || 3000,

  // MongoDB (Main App)
  mongo: {
    url: process.env.MONGO_URI,
    db: process.env.MONGO_URI.split('/').pop() || 'chitrac'
  },

  // MongoDB (Winston Logging)
  mongoLog: {
    url: process.env.MONGO_LOG_URI,
    db: process.env.MONGO_LOG_DB
  },

  //Session Collection names
  machineCollectionName: 'machine',
  stateTickerCollectionName: 'stateTicker',
  machineSessionCollectionName: 'machine-session',
  operatorSessionCollectionName: 'operator-session',
  itemSessionCollectionName: 'item-session',
  faultSessionCollectionName: 'fault-session',

  jwtSecret: process.env.JWT_SECRET,
  logLevel: process.env.LOG_LEVEL || 'info',
  inDev: process.env.NODE_ENV === 'development',
  
  // Hybrid query configuration
  hybridThresholdHours: parseInt(process.env.HYBRID_THRESHOLD_HOURS, 10) || 36
};
