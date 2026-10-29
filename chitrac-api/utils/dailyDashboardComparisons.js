const { DateTime } = require('luxon');
const { SYSTEM_TIMEZONE } = require('./time');
const {
  buildMachineOEEFromDailyTotals,
  buildItemTotalsFromCache,
  buildTopOperatorEfficiencyFromCache,
  buildTopOperatorEfficiencyFromSessions,
} = require('./dashboardFunctions');

// Compare against the complete preceding plant day, even for a shift envelope.
async function buildPreviousDayComparisons(db, logger, dateStr) {
  const day = DateTime.fromISO(dateStr, { zone: SYSTEM_TIMEZONE }).minus({ days: 1 }).startOf('day');
  const start = day.toJSDate();
  const end = day.plus({ days: 1 }).minus({ milliseconds: 1 }).toJSDate();
  const [machines, items, cachedOperators] = await Promise.all([
    buildMachineOEEFromDailyTotals(db, start, end, logger),
    buildItemTotalsFromCache(db, start, end, logger, { includeZero: true }),
    buildTopOperatorEfficiencyFromCache(db, start, end, logger, { limit: null }),
  ]);
  const operators = cachedOperators.length === 0 || cachedOperators.every(op => op.efficiency === 0 && !op.metrics?.runtime?.total)
    ? await buildTopOperatorEfficiencyFromSessions(db, start, end, { limit: null })
    : cachedOperators;
  return { date: day.toISODate(), machines, items: items.items, operators };
}

function attachPreviousDayComparisons(data, previous) {
  const key = value => value == null ? null : String(value);
  const machines = new Map(previous.machines.filter(row => row.serial != null).map(row => [key(row.serial), row]));
  const items = new Map(previous.items.map(row => [row.itemName, row]));
  const operators = new Map(previous.operators.filter(row => row.id != null).map(row => [key(row.id), row]));
  const comparison = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? { date: previous.date, value } : null;
  data.machineOee = data.machineOee.map(row => ({
    ...row, previousDay: comparison(machines.get(key(row.serial))?.oee),
  }));
  data.itemTotals = { ...data.itemTotals, items: data.itemTotals.items.map(row => ({
    ...row, previousDay: comparison(items.get(row.itemName)?.totalCount),
  })) };
  data.topOperators = data.topOperators.map(row => {
    const match = operators.get(key(row.id));
    return { ...row, previousDay: comparison(match?.metrics?.runtime?.total > 0 ? match.efficiency : null) };
  });
  data.machineGroupEfficiency = data.machineGroupEfficiency.map(row => ({
    ...row, previousDay: comparison(row.efficiencyPreviousDay?.value == null ? null : row.efficiencyPreviousDay.value * 100),
  }));
  return data;
}

module.exports = { buildPreviousDayComparisons, attachPreviousDayComparisons };
