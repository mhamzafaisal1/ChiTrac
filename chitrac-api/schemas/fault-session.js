const sessionSchema = require('./session');

module.exports = {
  schema: sessionSchema.schema,
  utils: {
    ...sessionSchema.utils,
    initFaultSession: sessionSchema.utils.initSession,
    getFaultSessionSummary: sessionSchema.utils.getSessionSummary
  }
};
