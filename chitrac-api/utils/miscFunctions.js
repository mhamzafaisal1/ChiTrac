const { buildSoftrolCycleSummary } = require("./softrolFunctions");

function calculateOverlapFactor(sStart, sEnd, wStart, wEnd) {
  const ss = new Date(sStart);
  const se = new Date(sEnd || wEnd);
  const os = ss > wStart ? ss : wStart;
  const oe = se < wEnd ? se : wEnd;
  const ovSec = Math.max(0, (oe - os) / 1000);
  const fullSec = Math.max(0, (se - ss) / 1000);
  const f = fullSec > 0 ? ovSec / fullSec : 0;
  return { ovSec, fullSec, factor: f };
}

function assignOperatorsToRunningCyclesMulti(runningCycles, operatorCycles) {
  return runningCycles.map(run => {
    const runStart = new Date(run.start);
    const runEnd = new Date(run.end);
    const seen = new Set();
    const operators = [];
    for (const op of operatorCycles) {
      const opStart = new Date(op.start);
      const opEnd = new Date(op.end);
      const overlapStart = runStart > opStart ? runStart : opStart;
      const overlapEnd = runEnd < opEnd ? runEnd : opEnd;
      const overlapDuration = overlapEnd - overlapStart;
      if (overlapDuration > 0 && !seen.has(op.operatorId)) {
        operators.push({
          id: op.operatorId,
          name: op.name || null,
          station: op.station ?? null
        });
        seen.add(op.operatorId);
      }
      if (operators.length >= 8) break;
    }
    while (operators.length < 8) {
      operators.push({ id: -1, name: null, station: null });
    }
    return { ...run, operators };
  });
}

function buildStationAlignedOperators(overlappingOperatorCycles) {
  const operators = Array.from({ length: 8 }, (_, i) => ({
    id: -1,
    name: null,
    station: i + 1
  }));
  for (const op of overlappingOperatorCycles) {
    const stationIndex = (op.station ?? 1) - 1;
    if (stationIndex >= 0 && stationIndex < 8) {
      operators[stationIndex] = {
        id: op.operatorId,
        name: op.name ?? null,
        station: op.station
      };
    }
  }
  return operators;
}

async function getBookendedGlobalRange(db, serials, start, end) {
  const now = new Date();
  const effectiveEnd = new Date(end) > now ? now.toISOString() : end;

  let minPreStart = null;
  let maxPostEnd = null;

  for (const serial of serials) {
    const serialInt = parseInt(serial);

    const [beforeStart, afterEnd] = await Promise.all([
      db.collection("state")
        .find({ "machine.serial": serialInt, timestamp: { $lt: start } })
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray(),

      db.collection("state")
        .find({ "machine.serial": serialInt, timestamp: { $gt: effectiveEnd } })
        .sort({ timestamp: 1 })
        .limit(1)
        .toArray()
    ]);

    if (beforeStart.length) {
      const ts = beforeStart[0].timestamp;
      if (!minPreStart || new Date(ts) < new Date(minPreStart)) {
        minPreStart = ts;
      }
    }

    if (afterEnd.length) {
      const ts = afterEnd[0].timestamp;
      if (!maxPostEnd || new Date(ts) > new Date(maxPostEnd)) {
        maxPostEnd = ts;
      }
    }
  }

  const adjustedStart = minPreStart ? minPreStart : start;
  const adjustedEnd = maxPostEnd ? maxPostEnd : effectiveEnd;

  return { adjustedStart, adjustedEnd };
}

module.exports = {
  buildSoftrolCycleSummary,
  getBookendedGlobalRange,
  assignOperatorsToRunningCyclesMulti,
  buildStationAlignedOperators,
  calculateOverlapFactor
};
