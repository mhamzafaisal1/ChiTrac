const path = require("path");

// Load .env from the chitrac-api root (next to index.js), not process.cwd().
// Windows services often start with cwd = System32 or another folder, which
// would skip .env and leave connection strings / secrets unset.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const hasHttpsEnabledEnv = Object.prototype.hasOwnProperty.call(process.env, 'HTTPS_ENABLED');
const defaultTheme = ['light', 'dark'].includes(process.env.DEFAULT_THEME) ? process.env.DEFAULT_THEME : 'dark';
const systemName = process.env.SYSTEM_NAME || 'ChiTrac';
const logLevel = process.env.LOG_LEVEL || 'info';
const httpsEnabled = process.env.HTTPS_ENABLED === 'true';
const userPermissionsLevels = [
  'Root',
  'SysAdmin',
  'Admin',
  'Manager',
  'Supervisor',
  'Employee',
  'Operator',
  'Guest'
];
const percentBreakpoints = {
  poor: 0,
  okay: 70,
  good: 90
};
const oePercentBreakpoints = {
  poor: 0,
  okay: 60,
  good: 80
};

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

  // Collection names
  machineCollectionName: 'config-machine',
  operatorCollectionName: 'config-operator',
  itemCollectionName: 'config-item',
  faultCollectionName: 'config-fault',
  statusCollectionName: 'config-status',
  userCollectionName: 'config-user',
  shiftCollectionName: 'config-shift',
  systemPreferencesCollectionName: 'system-preferences',
  stateTickerCollectionName: 'ticker-state',
  machineSessionCollectionName: 'session-machine',
  operatorSessionCollectionName: 'session-operator',
  itemSessionCollectionName: 'session-item',
  totalsDailyCollectionName: 'totals-daily',
  totalsHourlyCollectionName: 'totals-hourly',

  jwtSecret: process.env.JWT_SECRET,
  logLevel,
  inDev: process.env.NODE_ENV === 'development',
  httpsEnabled,
  httpsEnabledEnvConfigured: hasHttpsEnabledEnv,
  httpsPort: parseInt(process.env.HTTPS_PORT, 10) || 50443,
  certificatesDir: path.join(__dirname, '..', 'certificates'),
  httpsKeyFile: 'chitrac.key',
  httpsCertFile: 'chitrac.crt',
  
  // Hybrid query configuration
  hybridThresholdHours: parseInt(process.env.HYBRID_THRESHOLD_HOURS, 10) || 36,

  // Delayed config apply wait time, in minutes.
  applyChangeWaitTime: parseInt(process.env.APPLYCHANGEWAITTIME, 10) || 10,
  
  // API Security Settings
  // Enable/disable API token authentication (default: true)
  enableApiTokenCheck: process.env.ENABLE_API_TOKEN_CHECK !== 'false',
  
  // UI Configuration
  // Show error modals in frontend (default: true)
  showErrorModals: process.env.SHOW_ERROR_MODALS !== 'false',
  
  // Theme Settings
  // Default theme for new users: 'light' or 'dark' (default: 'light')
  defaultTheme,
  
  // System Name
  // System name displayed in the navbar (fallback for when DB is unavailable)
  systemName,

  userPermissionsLevels,
  percentBreakpoints,
  oePercentBreakpoints,

  envPreferences: {
    systemName,
    defaultTheme,
    logLevel,
    httpsEnabled,
    userPermissionsLevels: [...userPermissionsLevels],
    percentBreakpoints: { ...percentBreakpoints },
    oePercentBreakpoints: { ...oePercentBreakpoints }
  },

  // Softrol API Settings
  // Enable/disable Softrol API routes and documentation (default: false)
  softrol: process.env.SOFTROL === 'true',

  // Milnor API Settings
  // Enable/disable Milnor API routes and documentation (default: false)
  milnor: process.env.MILNOR === 'true',
};
