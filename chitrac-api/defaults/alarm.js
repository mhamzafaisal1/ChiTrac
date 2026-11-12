const { fault } = require('./fault');

module.exports = {
  alarm: fault.map(record => ({ ...record, fault: true, stop: true }))
};
