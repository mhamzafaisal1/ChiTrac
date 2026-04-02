const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv();
addFormats(ajv);
const validateEmailFormat = ajv.compile({ type: 'string', format: 'email' });

/**
 * @param {unknown} raw
 * @returns {{ ok: true, email: string|null } | { ok: false, message: string }}
 */
function parseOptionalEmail(raw) {
  if (raw === undefined || raw === null) {
    return { ok: true, email: null };
  }
  const trimmed = String(raw).trim();
  if (trimmed === '') {
    return { ok: true, email: null };
  }
  const normalized = trimmed.toLowerCase();
  if (!validateEmailFormat(normalized)) {
    return { ok: false, message: 'Invalid email address.' };
  }
  return { ok: true, email: normalized };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive match for stored emails (legacy mixed case + normalized inserts).
 * @param {import('mongodb').Collection} userCollection
 * @param {string} normalizedEmail
 * @returns {Promise<import('mongodb').WithId<import('mongodb').Document> | null>}
 */
async function findUserByEmailCaseInsensitive(userCollection, normalizedEmail) {
  return userCollection.findOne({
    emailAddress: { $regex: new RegExp(`^${escapeRegex(normalizedEmail)}$`, 'i') }
  });
}

/**
 * @param {import('mongodb').Collection} userCollection
 * @param {string} normalizedEmail
 * @returns {Promise<boolean>}
 */
async function isEmailTaken(userCollection, normalizedEmail) {
  const found = await findUserByEmailCaseInsensitive(userCollection, normalizedEmail);
  return Boolean(found);
}

module.exports = {
  parseOptionalEmail,
  findUserByEmailCaseInsensitive,
  isEmailTaken
};
