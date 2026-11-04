const { ObjectId } = require('mongodb');
const sensitiveKey = key => /^(authorization|proxy-authorization|cookie|set-cookie|token|access.?token|refresh.?token|api.?key|x-api-key|x-api-token|jwt)$/i.test(key)
  || /password|secret|connection.?string|hashed.?token/i.test(key);

function redactText(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, separator, key) => {
      let decoded = key;
      try { decoded = decodeURIComponent(key.replace(/\+/g, ' ')); } catch {}
      return sensitiveKey(decoded) ? `${separator}${key}=[REDACTED]` : match;
    })
    .replace(/("([^"]+)"\s*:\s*)"(?:\\.|[^"\\])*"/g, (match, prefix, key) =>
      sensitiveKey(key) ? `${prefix}"[REDACTED]"` : match);
}

function sanitizeLogValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactText(value);
  if (value == null || typeof value !== 'object' || value instanceof Date || value instanceof ObjectId) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const result = Array.isArray(value) ? value.map(item => sanitizeLogValue(item, seen))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      sensitiveKey(key) ? '[REDACTED]' : sanitizeLogValue(item, seen)]));
  seen.delete(value);
  return result;
}

module.exports = { sanitizeLogValue };
