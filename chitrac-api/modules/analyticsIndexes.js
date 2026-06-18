async function createIndex(collection, keys, options, logger) {
  try {
    await collection.createIndex(keys, { background: true, ...options });
  } catch (error) {
    logger.warn(`Failed to create analytics index ${options.name}: ${error.message}`);
  }
}

async function ensureAnalyticsIndexes(db, config, logger) {
  const totalsDaily = db.collection(config.totalsDailyCollectionName);
  const totalsHourly = db.collection(config.totalsHourlyCollectionName);
  const totalsShift = db.collection("totals-shift");
  const tickerState = db.collection(config.stateTickerCollectionName);
  const machineSessions = db.collection(config.machineSessionCollectionName);
  const operatorSessions = db.collection(config.operatorSessionCollectionName);

  await Promise.all([
    createIndex(
      totalsDaily,
      { entityType: 1, date: 1, machineSerial: 1 },
      { name: "machine_dashboard_daily_lookup" },
      logger
    ),
    createIndex(
      totalsHourly,
      { entityType: 1, date: 1, machineSerial: 1, hour: 1 },
      { name: "machine_dashboard_hourly_lookup" },
      logger
    ),
    createIndex(
      totalsShift,
      { shiftId: 1, entityType: 1, date: 1, machineSerial: 1 },
      { name: "dashboard_shift_machine_lookup" },
      logger
    ),
    createIndex(
      totalsShift,
      { shiftId: 1, entityType: 1, date: 1, operatorId: 1 },
      { name: "dashboard_shift_operator_lookup" },
      logger
    ),
    createIndex(
      tickerState,
      { "machine.serial": 1 },
      { name: "ticker_state_machine_serial" },
      logger
    ),
    createIndex(
      tickerState,
      { "machine.id": 1 },
      { name: "ticker_state_machine_id" },
      logger
    ),
    createIndex(
      operatorSessions,
      {
        "operator.id": 1,
        "machine.serial": 1,
        "timestamps.end": 1,
        "timestamps.create": -1,
      },
      { name: "operator_session_current_by_machine_serial" },
      logger
    ),
    createIndex(
      operatorSessions,
      {
        "operator.id": 1,
        "machine.id": 1,
        "timestamps.end": 1,
        "timestamps.create": -1,
      },
      { name: "operator_session_current_by_machine_id" },
      logger
    ),
    createIndex(
      operatorSessions,
      { "operator.id": 1, "machine.serial": 1, "timestamps.create": -1 },
      { name: "operator_session_latest_by_machine_serial" },
      logger
    ),
    createIndex(
      operatorSessions,
      { "operator.id": 1, "machine.id": 1, "timestamps.create": -1 },
      { name: "operator_session_latest_by_machine_id" },
      logger
    ),
    createIndex(
      machineSessions,
      {
        "machine.serial": 1,
        "timestamps.start": 1,
        "timestamps.end": 1,
        type: 1,
      },
      { name: "machine_session_fault_history_by_serial" },
      logger
    ),
    createIndex(
      machineSessions,
      {
        "machine.id": 1,
        "timestamps.start": 1,
        "timestamps.end": 1,
        type: 1,
      },
      { name: "machine_session_fault_history_by_id" },
      logger
    ),
    createIndex(
      machineSessions,
      {
        "operators.id": 1,
        "timestamps.start": 1,
        "timestamps.end": 1,
        type: 1,
      },
      { name: "machine_session_fault_history_by_operator" },
      logger
    ),
  ]);
}

module.exports = {
  ensureAnalyticsIndexes,
};
