const path = require("path");

// Load .env from the chitrac-api root (next to index.js), not process.cwd().
// Windows services often start with cwd = System32 or another folder, which
// would skip .env and leave connection strings / secrets unset.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

module.exports = {
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT, 10) || 3000,

  // MongoDB (Main App) — full URI; database is the path (e.g. .../chitrac)
  mongo: {
    connectionString: process.env.MONGO_CONN_STRING,
  },

  // MongoDB (Winston Logging) — full URI; database is the path (e.g. .../chitrac-logging)
  mongoLog: {
    connectionString: process.env.MONGO_LOG_CONN_STRING,
  },

  //Session Collection names
  machineCollectionName: 'machine',
  stateTickerCollectionName: 'stateTicker',
  machineSessionCollectionName: 'machine-session',
  operatorSessionCollectionName: 'operator-session',
  itemSessionCollectionName: 'item-session',
  faultSessionCollectionName: 'fault-session',
  pausedSessionCollectionName: 'paused-session',

  jwtSecret: process.env.JWT_SECRET,
  logLevel: process.env.LOG_LEVEL || 'info',
  inDev: process.env.NODE_ENV === 'development',
  
  // Hybrid query configuration
  hybridThresholdHours: parseInt(process.env.HYBRID_THRESHOLD_HOURS, 10) || 36,
  
  // API Security Settings
  // Enable/disable API token authentication (default: true)
  enableApiTokenCheck: process.env.ENABLE_API_TOKEN_CHECK !== 'false',
  
  // UI Configuration
  // Show error modals in frontend (default: true)
  showErrorModals: process.env.SHOW_ERROR_MODALS !== 'false',
  
  // Theme Settings
  // Default theme for new users: 'light' or 'dark' (default: 'light')
  defaultTheme: ['light', 'dark'].includes(process.env.DEFAULT_THEME) ? process.env.DEFAULT_THEME : 'dark',
  
  // System Name
  // System name displayed in the navbar (fallback for when DB is unavailable)
  systemName: process.env.SYSTEM_NAME || 'ChiTrac',

  // Softrol API Settings
  // Enable/disable Softrol API routes and documentation (default: false)
  softrol: process.env.SOFTROL === 'true',

  // Milnor API Settings
  // Enable/disable Milnor API routes and documentation (default: false)
  milnor: process.env.MILNOR === 'true',
};
