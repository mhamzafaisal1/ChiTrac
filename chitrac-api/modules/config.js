require('dotenv').config();

module.exports = {
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT, 10) || 3000,

  // MongoDB (Main App)
  mongo: {
    url: process.env.MONGO_URI,
    db: process.env.MONGO_URI.split('/').pop() || 'chitrac',
    username: process.env.MONGO_USERNAME ,
    password: process.env.MONGO_PASSWORD 
  },

  // MongoDB (Winston Logging)
  mongoLog: {
    url: process.env.MONGO_LOG_URI,
    db: process.env.MONGO_LOG_DB,
    username: process.env.MONGO_LOG_USERNAME || process.env.MONGO_USERNAME,
    password: process.env.MONGO_LOG_PASSWORD || process.env.MONGO_PASSWORD
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
  systemName: process.env.SYSTEM_NAME || 'ChiTrac'

  // Softrol API Settings
  // Enable/disable Softrol API routes and documentation (default: false)
  softrol: process.env.SOFTROL === 'true'
};
