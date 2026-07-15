const RESERVED_DEFAULT_KEYS = new Set(['_id', 'createdAt', 'updatedAt']);

function cloneDefaultValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneDefaultValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, '$date')
  ) {
    return new Date(value.$date);
  }

  const clone = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (RESERVED_DEFAULT_KEYS.has(key)) continue;
    clone[key] = cloneDefaultValue(childValue);
  }
  return clone;
}

function cloneDefaultDocuments(documents) {
  return cloneDefaultValue(documents || []);
}

module.exports = {
  cloneDefaultDocuments,
};
