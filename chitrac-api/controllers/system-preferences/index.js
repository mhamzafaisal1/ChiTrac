const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../../modules/config');
const { assertPermissionLevel } = require('../../modules/permissions');
const systemPreferencesSchema = require('../../schemas/system-preferences');
const systemPreferences = require('../../modules/systemPreferences');
const { ObjectId } = require('mongodb');

const SINGLETON_ID = systemPreferences.SINGLETON_ID;

module.exports = function(server) {
  return constructor(server);
};

function constructor(server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;
  const collection = systemPreferences.getCollection(db, config);
  const userCollection = db.collection('user');

  collection.createIndex({ _id: 1 }, { unique: true }).catch(() => {});

  function extractToken(req) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
    if (typeof req.query?.token === 'string') return req.query.token;
    if (typeof req.body?.token === 'string') return req.body.token;
    return null;
  }

  function getTokenUserId(payload) {
    const rawUserId = payload?.userId;
    if (!rawUserId) return null;
    if (typeof rawUserId === 'string') return rawUserId;
    if (typeof rawUserId === 'object' && rawUserId.$oid) return rawUserId.$oid;
    return `${rawUserId}`;
  }

  function requirePermissionLevel(requiredLevel) {
    return async function(req, res, next) {
      if (config.enableApiTokenCheck === false) {
        req.authUser = { active: true, permissions: { level: 0 } };
        return next();
      }

      try {
        const token = extractToken(req);
        if (!token) return res.status(401).json({ error: 'Missing token' });

        const payload = jwt.verify(token, config.jwtSecret);
        const tokenUserId = getTokenUserId(payload);
        if (!tokenUserId) return res.status(401).json({ error: 'Invalid token payload' });

        const user = await userCollection.findOne({ _id: new ObjectId(tokenUserId) });
        assertPermissionLevel(user, requiredLevel);
        req.authUser = user;
        return next();
      } catch (error) {
        logger?.error?.('System preferences permission check failed:', error);
        return res.status(error.status || 401).json({ error: error.message || 'Invalid token' });
      }
    };
  }

  async function ensureSystemPreferences() {
    return systemPreferences.ensureSystemPreferences(db, config);
  }

  async function getSystemPreferences(req, res, next) {
    try {
      res.json(await ensureSystemPreferences());
    } catch (error) {
      next(error);
    }
  }

  async function upsertSystemPreferences(req, res, next) {
    try {
      const existing = await ensureSystemPreferences();
      const preferences = systemPreferencesSchema.utils.normalizePreferences(req.body, existing, config);
      const { _id, ...updates } = preferences;
      await collection.updateOne(
        { _id: SINGLETON_ID },
        { $set: updates, $setOnInsert: { _id } },
        { upsert: true }
      );
      res.json(await collection.findOne({ _id: SINGLETON_ID }));
    } catch (error) {
      next(error);
    }
  }

  async function resetSystemPreferences(req, res, next) {
    try {
      const existing = await ensureSystemPreferences();
      const preferences = systemPreferencesSchema.utils.normalizePreferences(
        systemPreferencesSchema.utils.buildDefaultPreferences(config),
        existing,
        config
      );
      const { _id, ...updates } = preferences;
      await collection.updateOne(
        { _id: SINGLETON_ID },
        { $set: updates, $setOnInsert: { _id } },
        { upsert: true }
      );
      res.json(await collection.findOne({ _id: SINGLETON_ID }));
    } catch (error) {
      next(error);
    }
  }

  router.get('/', getSystemPreferences);
  router.get('/config', getSystemPreferences);
  router.post('/', requirePermissionLevel(7), upsertSystemPreferences);
  router.post('/config', requirePermissionLevel(7), upsertSystemPreferences);
  router.put('/', requirePermissionLevel(7), upsertSystemPreferences);
  router.put('/config', requirePermissionLevel(7), upsertSystemPreferences);
  router.delete('/', requirePermissionLevel(7), resetSystemPreferences);
  router.delete('/config', requirePermissionLevel(7), resetSystemPreferences);

  return router;
}
