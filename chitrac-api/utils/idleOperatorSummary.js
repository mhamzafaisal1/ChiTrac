function normalizeOperatorId(id) {
  if (id === null || typeof id === "undefined" || id === -1) return null;
  const numeric = typeof id === "string" ? Number.parseInt(id, 10) : Number(id);
  return Number.isFinite(numeric) && numeric !== -1 ? numeric : null;
}

function emptyIdleOperatorSummary() {
  return {
    idleOperators: 0,
    shiftOperators: 0,
    activeOperators: 0,
    idleOperatorIds: [],
    shiftId: null,
    shiftMode: "none",
    start: null,
    end: null,
    updatedAt: new Date().toISOString(),
  };
}

async function buildIdleOperatorSummary(db, config, shiftContext) {
  if (!shiftContext) return emptyIdleOperatorSummary();

  const start = new Date(shiftContext.start);
  const end = new Date(shiftContext.end);
  const sessionFilter = {
    "operator.id": { $exists: true, $ne: -1 },
    "timestamps.start": { $lt: end },
    $or: [
      { "timestamps.end": { $exists: false } },
      { "timestamps.end": null },
      { "timestamps.end": { $gt: start } },
    ],
  };

  const [operatorSessions, stateTickerData] = await Promise.all([
    db
      .collection(config.operatorSessionCollectionName)
      .find(sessionFilter)
      .project({ _id: 0, operator: 1 })
      .toArray(),
    db
      .collection(config.stateTickerCollectionName)
      .find({})
      .project({ _id: 0, operators: 1 })
      .toArray(),
  ]);

  const shiftOperatorIds = new Set();
  for (const session of operatorSessions) {
    const operatorId = normalizeOperatorId(session.operator?.id);
    if (operatorId !== null) shiftOperatorIds.add(operatorId);
  }

  const activeOperatorIds = new Set();
  for (const ticker of stateTickerData) {
    if (!Array.isArray(ticker.operators)) continue;
    for (const operator of ticker.operators) {
      const operatorId = normalizeOperatorId(operator?.id);
      if (operatorId !== null) activeOperatorIds.add(operatorId);
    }
  }

  const idleOperatorIds = [...shiftOperatorIds].filter((operatorId) => !activeOperatorIds.has(operatorId));

  return {
    idleOperators: idleOperatorIds.length,
    shiftOperators: shiftOperatorIds.size,
    activeOperators: activeOperatorIds.size,
    idleOperatorIds,
    shiftId: shiftContext.shiftOid ? String(shiftContext.shiftOid) : null,
    shiftMode: shiftContext.mode || null,
    start,
    end,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildIdleOperatorSummary,
  emptyIdleOperatorSummary,
  normalizeOperatorId,
};
