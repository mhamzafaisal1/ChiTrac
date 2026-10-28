/** Legacy device fields are accepted at the boundary; session identity uses id. */
function normalizeMachine(machine = {}) {
  const id = machine.id ?? machine.serial;
  if (id === undefined || id === null || id === '') throw new Error('A machine id or legacy serial is required');
  return { ...machine, id, serial: machine.serial ?? id };
}

// A legacy alias must never override an explicitly stored canonical identity.
// Wrap in $and so callers can also supply a time-window $or.
function identityQuery(entity, id, legacyField, legacyValue = id) {
  return { $and: [{ $or: [
    { [entity + '.id']: id },
    { [entity + '.id']: null, [entity + '.' + legacyField]: legacyValue },
  ] }] };
}

function sessionMachineQuery(machine) {
  if (machine && typeof machine === 'object' && !Object.keys(machine).some(key => key.startsWith('$'))) {
    const normalized = normalizeMachine(machine);
    return identityQuery('machine', normalized.id, 'serial', normalized.serial);
  }
  return identityQuery('machine', machine, 'serial');
}

function sessionIdentityQuery(machine, operatorId) {
  const query = sessionMachineQuery(machine);
  if (operatorId === undefined) return query;
  return { $and: [...query.$and, ...identityQuery('operator', operatorId, 'code').$and] };
}

module.exports = { normalizeMachine, sessionMachineQuery, sessionIdentityQuery };

async function distinctSessionMachineIds(collection, query) {
  const rows = await collection.aggregate([
    { $match: query },
    { $group: { _id: { $ifNull: ['$machine.id', '$machine.serial'] } } },
    { $match: { _id: { $ne: null } } },
  ]).toArray();
  return rows.map(row => row._id);
}
module.exports.distinctSessionMachineIds = distinctSessionMachineIds;
