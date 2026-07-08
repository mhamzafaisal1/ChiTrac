const humanNamesSchema = require('../schemas/human-names');

/**
 * Format persisted human-name data while retaining read compatibility with
 * legacy string values during migration.
 * @param {object|string|null} name - Human-names object or legacy string
 * @param {string} fallback - Value returned when the name cannot be formatted
 * @param {'fullName'|'fullNameShort'} format - Desired display format
 * @returns {string} Display name
 */
function formatHumanName(name, fallback = 'Unknown', format = 'fullName') {
  if (typeof name === 'string') {
    return name.trim() || fallback;
  }

  if (!name || typeof name !== 'object' || Array.isArray(name)) {
    return fallback;
  }

  try {
    return humanNamesSchema.utils.getFormattedNames(name)[format] || fallback;
  } catch (_) {
    return fallback;
  }
}

module.exports = {
  formatHumanName
};
