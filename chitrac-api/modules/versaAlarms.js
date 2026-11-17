// Enrich Versa's nested status using its own catalog; Chicago alarm IDs belong
// to a separate namespace. Invalid or unknown data must still be retained.
async function enrichVersaAlarm(message, db, logger) {
  const status = message.status;
  if (!status || typeof status !== 'object' || Array.isArray(status) ||
      !Object.prototype.hasOwnProperty.call(status, 'alarmCode')) return message;

  // Zero is a valid ID. Never coerce null, booleans or empty strings to zero.
  const code = typeof status.alarmCode === 'string' && /^\d+$/.test(status.alarmCode)
    ? Number(status.alarmCode) : status.alarmCode;
  if (!Number.isSafeInteger(code) || code < 0) {
    logger?.warn('Invalid Versa status.alarmCode; storing message without alarm enrichment');
    return message;
  }

  const definition = await db.collection('config-alarm-versa').findOne({ id: code });
  if (!definition) {
    logger?.warn(`No config-alarm-versa definition for alarmCode ${code}; storing message unchanged`);
    return message;
  }
  if (typeof definition.stop !== 'boolean' || typeof definition.name !== 'string' || !definition.name.trim()) {
    logger?.warn(`Invalid config-alarm-versa definition for alarmCode ${code}; storing message without alarm enrichment`);
    return message;
  }
  return { ...message, status: { ...status, stop: definition.stop, name: definition.name } };
}

module.exports = { enrichVersaAlarm };
