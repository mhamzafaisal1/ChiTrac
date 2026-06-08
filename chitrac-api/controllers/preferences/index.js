const express = require('express');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const config = require('../../modules/config');
const { assertPermissionLevel } = require('../../modules/permissions');
const systemPreferences = require('../../modules/systemPreferences');
const systemPreferencesSchema = require('../../schemas/system-preferences');

const SYSTEM_SINGLETON_ID = systemPreferences.SINGLETON_ID;

module.exports = function(server) {
  return constructor(server);
};

function constructor(server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;
  const systemPreferencesCollection = systemPreferences.getCollection(db, config);
  const userPreferencesCollection = db.collection('user-preferences');
  const userCollection = db.collection('user');

  systemPreferencesCollection.createIndex({ _id: 1 }, { unique: true }).catch(() => {});
  userPreferencesCollection.createIndex({ userId: 1 }, { unique: true }).catch(() => {});

  function extractToken(req) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
    if (typeof req.query?.token === 'string') return req.query.token;
    if (typeof req.body?.token === 'string') return req.body.token;
    return null;
  }

  function getTokenUserId(payload) {
    const rawUserId = payload?.userId || payload?.createdBy;
    if (!rawUserId) return null;
    if (typeof rawUserId === 'string') return rawUserId;
    if (typeof rawUserId === 'object' && rawUserId.$oid) return rawUserId.$oid;
    return `${rawUserId}`;
  }

  async function attachOptionalUser(req, res, next) {
    if (config.enableApiTokenCheck === false) {
      req.tokenPayload = { bypassed: true };
      return next();
    }

    try {
      const token = extractToken(req);
      if (!token) return next();

      const payload = jwt.verify(token, config.jwtSecret);
      const tokenUserId = getTokenUserId(payload);
      if (!tokenUserId) return next();

      const user = await userCollection.findOne({ _id: new ObjectId(tokenUserId) });
      if (!user || user.active === false) return next();

      req.tokenPayload = payload;
      req.authUser = user;
      req.authUserId = tokenUserId;
      return next();
    } catch (error) {
      logger?.warn?.('Optional preference user lookup failed:', error.message || error);
      return next();
    }
  }

  function requireUser(req, res, next) {
    if (config.enableApiTokenCheck === false) {
      req.tokenPayload = { bypassed: true };
      req.authUserId = 'bypassed';
      return next();
    }

    try {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ error: 'Missing token' });

      const payload = jwt.verify(token, config.jwtSecret);
      const tokenUserId = getTokenUserId(payload);
      if (!tokenUserId) return res.status(401).json({ error: 'Invalid token payload' });

      req.tokenPayload = payload;
      req.authUserId = tokenUserId;
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
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
        req.tokenPayload = payload;
        req.authUser = user;
        req.authUserId = tokenUserId;
        return next();
      } catch (error) {
        logger?.error?.('Preferences permission check failed:', error);
        return res.status(error.status || 401).json({ error: error.message || 'Invalid token' });
      }
    };
  }

  function buildEnvPreferences() {
    if (config.envPreferences) {
      return {
        ...config.envPreferences,
        percentBreakpoints: config.envPreferences.percentBreakpoints
          ? { ...config.envPreferences.percentBreakpoints }
          : undefined,
        userPermissionsLevels: Array.isArray(config.envPreferences.userPermissionsLevels)
          ? [...config.envPreferences.userPermissionsLevels]
          : []
      };
    }

    return {
      systemName: config.systemName,
      defaultTheme: config.defaultTheme,
      logLevel: config.logLevel,
      httpsEnabled: config.httpsEnabled,
      percentBreakpoints: config.percentBreakpoints ? { ...config.percentBreakpoints } : undefined,
      userPermissionsLevels: Array.isArray(config.userPermissionsLevels)
        ? [...config.userPermissionsLevels]
        : []
    };
  }

  function sanitizeUserPreferences(input = {}, userId) {
    const preferences = {};

    if (typeof input.theme === 'string') {
      if (!['light', 'dark'].includes(input.theme)) {
        const error = new Error("Invalid theme. Must be 'light' or 'dark'");
        error.status = 400;
        throw error;
      }
      preferences.theme = input.theme;
    }

    if (typeof input.defaultTheme === 'string') {
      if (!['light', 'dark'].includes(input.defaultTheme)) {
        const error = new Error("Invalid defaultTheme. Must be 'light' or 'dark'");
        error.status = 400;
        throw error;
      }
      preferences.defaultTheme = input.defaultTheme;
    }

    preferences.userId = userId;
    preferences.updatedAt = new Date();
    return preferences;
  }

  function mergePreferences(envPreferences, systemPrefs, userPrefs) {
    const { _id: systemId, createdAt: systemCreatedAt, updatedAt: systemUpdatedAt, ...systemValues } = systemPrefs || {};
    const { _id: userPreferenceId, userId, createdAt: userCreatedAt, updatedAt: userUpdatedAt, theme, ...userValues } = userPrefs || {};

    return {
      ...envPreferences,
      ...systemValues,
      ...userValues,
      ...(theme ? { defaultTheme: theme, theme } : {})
    };
  }

  async function getSystemPreferences(req, res, next) {
    try {
      res.json(await systemPreferences.ensureSystemPreferences(db, config));
    } catch (error) {
      next(error);
    }
  }

  async function upsertSystemPreferences(req, res, next) {
    try {
      const existing = await systemPreferences.ensureSystemPreferences(db, config);
      const preferences = systemPreferencesSchema.utils.normalizePreferences(req.body, existing, config);
      const { _id, ...updates } = preferences;
      await systemPreferencesCollection.updateOne(
        { _id: SYSTEM_SINGLETON_ID },
        { $set: updates, $setOnInsert: { _id } },
        { upsert: true }
      );
      const saved = await systemPreferencesCollection.findOne({ _id: SYSTEM_SINGLETON_ID });
      systemPreferences.applySystemPreferences(config, saved);
      server.systemPreferences = saved;
      res.json(saved);
    } catch (error) {
      next(error);
    }
  }

  async function resetSystemPreferences(req, res, next) {
    try {
      const existing = await systemPreferences.ensureSystemPreferences(db, config);
      const preferences = systemPreferencesSchema.utils.normalizePreferences(
        systemPreferencesSchema.utils.buildDefaultPreferences(config),
        existing,
        config
      );
      const { _id, ...updates } = preferences;
      await systemPreferencesCollection.updateOne(
        { _id: SYSTEM_SINGLETON_ID },
        { $set: updates, $setOnInsert: { _id } },
        { upsert: true }
      );
      const saved = await systemPreferencesCollection.findOne({ _id: SYSTEM_SINGLETON_ID });
      systemPreferences.applySystemPreferences(config, saved);
      server.systemPreferences = saved;
      res.json(saved);
    } catch (error) {
      next(error);
    }
  }

  async function getUserPreferences(req, res, next) {
    try {
      const prefs = await userPreferencesCollection.findOne({ userId: req.authUserId });
      res.json(prefs || { userId: req.authUserId });
    } catch (error) {
      next(error);
    }
  }

  async function upsertUserPreferences(req, res, next) {
    try {
      if (req.tokenPayload?.bypassed) {
        return res.status(401).json({ error: 'Authentication required to save preferences' });
      }

      const preferences = sanitizeUserPreferences(req.body, req.authUserId);
      const { userId, ...updates } = preferences;
      await userPreferencesCollection.updateOne(
        { userId: req.authUserId },
        {
          $set: updates,
          $setOnInsert: {
            userId: req.authUserId,
            createdAt: new Date()
          }
        },
        { upsert: true }
      );

      res.json(await userPreferencesCollection.findOne({ userId: req.authUserId }));
    } catch (error) {
      next(error);
    }
  }

  async function deleteUserPreferences(req, res, next) {
    try {
      const result = await userPreferencesCollection.deleteOne({ userId: req.authUserId });
      res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
      next(error);
    }
  }

  router.get('/currentPreferences', attachOptionalUser, async (req, res, next) => {
    try {
      const envPreferences = buildEnvPreferences();
      const systemPrefs = await systemPreferences.ensureSystemPreferences(db, config);
      const userPrefs = req.authUserId
        ? await userPreferencesCollection.findOne({ userId: req.authUserId })
        : null;

      res.json({
        preferences: mergePreferences(envPreferences, systemPrefs, userPrefs),
        sources: {
          env: envPreferences,
          system: systemPrefs || null,
          user: userPrefs || null
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/user/theme', requireUser, async (req, res, next) => {
    try {
      if (req.tokenPayload?.bypassed) {
        return res.json({ theme: config.defaultTheme, source: 'default' });
      }

      const userPrefs = await userPreferencesCollection.findOne({ userId: req.authUserId });
      if (userPrefs?.theme) {
        return res.json({ theme: userPrefs.theme, source: 'user' });
      }

      res.json({ theme: config.defaultTheme, source: 'default' });
    } catch (error) {
      next(error);
    }
  });

  router.put('/user/theme', requireUser, async (req, res, next) => {
    try {
      if (req.tokenPayload?.bypassed) {
        return res.status(401).json({ error: 'Authentication required to save preferences' });
      }

      const { theme } = req.body;
      const preferences = sanitizeUserPreferences({ theme }, req.authUserId);
      const { userId, ...updates } = preferences;
      await userPreferencesCollection.updateOne(
        { userId: req.authUserId },
        {
          $set: updates,
          $setOnInsert: {
            userId: req.authUserId,
            createdAt: new Date()
          }
        },
        { upsert: true }
      );

      res.json({ success: true, theme, message: 'Theme preference saved' });
    } catch (error) {
      next(error);
    }
  });

  router.get('/system', getSystemPreferences);
  router.get('/system/config', getSystemPreferences);
  router.post('/system', requirePermissionLevel(7), upsertSystemPreferences);
  router.post('/system/config', requirePermissionLevel(7), upsertSystemPreferences);
  router.put('/system', requirePermissionLevel(7), upsertSystemPreferences);
  router.put('/system/config', requirePermissionLevel(7), upsertSystemPreferences);
  router.delete('/system', requirePermissionLevel(7), resetSystemPreferences);
  router.delete('/system/config', requirePermissionLevel(7), resetSystemPreferences);

  router.get('/user', requireUser, getUserPreferences);
  router.post('/user', requireUser, upsertUserPreferences);
  router.put('/user', requireUser, upsertUserPreferences);
  router.delete('/user', requireUser, deleteUserPreferences);

  return router;
}
