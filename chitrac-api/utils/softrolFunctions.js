const {
  processCountStatistics,
  groupCountsByItem
} = require("./count");
const {
  calculateOperatorTimes,
  calculateEfficiency,
  calculatePiecesPerHour
} = require("./analytics");

/**
 * Builds a detailed summary for a Softrol cycle
 * @param {Object} cycle - The cycle object containing start, end, and states
 * @param {Array} sortedCounts - Array of counts sorted by timestamp
 * @param {Object} countGroup - Group of counts with operator and machine info
 * @returns {Object|null} Detailed cycle summary or null if no counts
 */
function buildSoftrolCycleSummary(cycle, sortedCounts, countGroup) {
  const cycleStart = new Date(cycle.start);
  const cycleEnd = new Date(cycle.end);

  const cycleCounts = sortedCounts.filter(c => {
    const ts = new Date(c.timestamp);
    return ts >= cycleStart && ts <= cycleEnd && !c.misfeed;
  });

  if (!cycleCounts.length) return null;

  const stats = processCountStatistics(cycleCounts);
  const { runtime } = calculateOperatorTimes(cycle.states, cycleStart, cycleEnd);
  const piecesPerHour = calculatePiecesPerHour(stats.total, runtime);
  const efficiency = calculateEfficiency(runtime, stats.total, cycleCounts);

  const standard = efficiency > 0
    ? parseFloat((piecesPerHour / efficiency).toFixed(2))
    : 0;

  const itemGroups = groupCountsByItem(cycleCounts.filter(c => c.item));
  const task = Object.entries(itemGroups)
    .map(([_, group]) => group[0]?.item?.name || "Unknown")
    .join(", ");

  return {
    startTimestamp: cycleStart.toISOString(),
    endTimestamp: cycleEnd.toISOString(),
    totalCount: stats.total,
    task,
    standard: Math.round(standard)
  };
}

module.exports = {
  buildSoftrolCycleSummary
};
