const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const config = require('../modules/config');
const { tokenHashInput } = require('./apiTokenHash');
const timestampsSchema = require('../schemas/timestampsSchema');
const authentication = Symbol('apiAuthentication');
const verifiedRequest = Symbol('verifiedApiAuthentication');

function extractToken(req) {
  const headers = req.headers || {};
  const bearer = headers.authorization || headers.Authorization;
  if (typeof bearer === 'string' && /^Bearer\s+/i.test(bearer)) return bearer.replace(/^Bearer\s+/i, '').trim();
  for (const key of ['x-api-key', 'x-api-token', 'api-key', 'apikey']) {
    if (typeof headers[key] === 'string') return headers[key].trim();
  }
  if (typeof req.query?.token === 'string') return req.query.token;
  if (typeof req.body?.token === 'string') return req.body.token;
  return null;
}

function normalizeTokenUserId(rawUserId) {
  if (!rawUserId) return null;
  if (typeof rawUserId === 'string') return rawUserId;
  if (typeof rawUserId === 'object' && rawUserId.$oid) return rawUserId.$oid;
  return `${rawUserId}`;
}

function authError(message, status = 401) {
  return Object.assign(new Error(message), { status });
}

async function recordUsage(server, req, tokenDoc) {
  const now = new Date();
  try {
    const update = { $inc: { usageCount: 1 }, $max: { lastUsed: now, 'timestamps.update': now } };
    // Legacy records may only have createdAt. Do not restamp activation on use.
    const initial = timestampsSchema.utils.stampInit(tokenDoc.timestamps?.create || tokenDoc.createdAt || now);
    const missing = {};
    for (const key of ['create', 'active']) {
      if (tokenDoc.timestamps?.[key] == null) missing[`timestamps.${key}`] = initial[key];
    }
    if (Object.keys(missing).length) update.$set = missing;
    const result = await server.db.collection('auth-tokens').updateOne({ _id: tokenDoc._id }, update);
    req.authAudit.usageRecorded = result.matchedCount !== 0;
    if (result.matchedCount === 0) throw new Error('Token record disappeared during usage update');
  } catch {
    req.authAudit.usageRecorded = false;
    server.logger?.error?.('API token usage tracking failed', { tokenId: String(tokenDoc._id), tokenName: tokenDoc.name });
  }
}

// Optional auditing and nested guards share one request-scoped verification and
// counter update. Auditing alone never grants access to a protected endpoint.
function authenticate(req, server) {
  if (req[authentication]) return req[authentication];
  req[authentication] = (async () => {
    const token = extractToken(req);
    req.authAudit = {
      mode: config.enableApiTokenCheck === false ? 'bypass' : token ? 'token' : req.isAuthenticated?.() ? 'session' : 'anonymous',
      credentialSupplied: Boolean(token), result: 'not_supplied',
    };
    if (!token && !req.isAuthenticated?.()) throw authError('Missing token');
    req.authAudit.result = 'pending';
    if (!config.jwtSecret) throw authError('Server config error', 500);
    let decoded;
    try { decoded = token ? jwt.verify(token, config.jwtSecret) : { userId: String(req.user._id) }; }
    catch { throw authError('Invalid token'); }
    if (decoded.type === 'permanent') {
      let tokenDoc;
      try {
        tokenDoc = await server.db.collection('auth-tokens').findOne({ name: decoded.name, createdBy: decoded.createdBy, isActive: true });
      } catch { throw authError('Authentication unavailable', 503); }
      if (!tokenDoc || tokenDoc.deactivatedAt || tokenDoc.timestamps?.inactive) throw authError('Token not found or inactive');
      if (tokenDoc.hashedTokenVersion != null && ![1, 2].includes(tokenDoc.hashedTokenVersion)) throw authError('Invalid token record');
      if (!await bcrypt.compare(tokenHashInput(token, tokenDoc.hashedTokenVersion), tokenDoc.hashedToken)) throw authError('Invalid token');
      Object.assign(req.authAudit, { result: 'verified', tokenId: String(tokenDoc._id), tokenName: tokenDoc.name });
      await recordUsage(server, req, tokenDoc);
      return { tokenPayload: { ...decoded, tokenId: tokenDoc._id, tokenName: tokenDoc.name, allowedControllers: tokenDoc.allowedControllers } };
    }
    const userId = normalizeTokenUserId(decoded.userId);
    if (decoded.type || !userId || !ObjectId.isValid(userId)) throw authError('Invalid user token');
    let user;
    try { user = await server.db.collection(config.userCollectionName).findOne({ _id: new ObjectId(userId) }); }
    catch { throw authError('Authentication unavailable', 503); }
    if (!user || user.active === false) throw authError('User not found or inactive');
    Object.assign(req.authAudit, { result: 'verified', userId });
    return { tokenPayload: decoded, authUser: user };
  })().catch(error => {
    if (req.authAudit && (req.authAudit.result === 'pending' || error.status >= 500)) {
      req.authAudit.result = error.status >= 500 ? 'unavailable' : 'invalid';
    }
    throw error;
  });
  return req[authentication];
}

function createTokenAuditMiddleware(server) {
  return async (req, res, next) => {
    if (req.method !== 'OPTIONS' && extractToken(req)) {
      try { await authenticate(req, server); }
      catch { /* Preserve public/bypassed access even when attribution fails. */ }
    }
    next();
  };
}

function createVerifyJwtMiddleware(server) {
  return async function verifyJwtMiddleware(req, res, next) {
    if (req[verifiedRequest]) return next();
    if (config.enableApiTokenCheck === false) {
      if (extractToken(req)) {
        try { await authenticate(req, server); } catch {}
      }
      req.tokenPayload = { bypassed: true };
      req.authAudit ||= { mode: 'bypass', credentialSupplied: false, result: 'not_supplied' };
      req[verifiedRequest] = true;
      return next();
    }
    try {
      Object.assign(req, await authenticate(req, server));
      req[verifiedRequest] = true;
    } catch (error) {
      return res.status(error.status || 401).json({ valid: false, error: error.status ? error.message : 'Token verification failed' });
    }
    return next();
  };
}

module.exports = { createVerifyJwtMiddleware, createTokenAuditMiddleware, extractToken, normalizeTokenUserId };
