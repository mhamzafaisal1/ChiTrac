const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const config = require('../../modules/config');
const { assertPermissionLevel, getPermissionLevel } = require('../../modules/permissions');

module.exports = function(server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;
  const userCollection = db.collection('user');
  const PASSWORD_MIN_LENGTH = 6;
  const PASSWORD_MAX_LENGTH = 64;

  function extractToken(req) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
    if (typeof req.query?.token === 'string') return req.query.token;
    if (typeof req.body?.token === 'string') return req.body.token;
    return null;
  }

  function requirePermissionLevel(requiredLevel) {
    return async function(req, res, next) {
      if (config.enableApiTokenCheck === false) {
        req.tokenPayload = { bypassed: true, username: 'root', permissions: { level: 0 } };
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
        return next();
      } catch (error) {
        logger?.error?.('Permission check failed:', error);
        return res.status(error.status || 401).json({ error: error.message || 'Invalid token' });
      }
    };
  }

  const requireUsersAccess = requirePermissionLevel(2);

  function getVisibleUserFilter(authUser, additionalFilter = {}) {
    const authLevel = getPermissionLevel(authUser);
    if (authLevel === null) return { ...additionalFilter, _id: null };

    const levelFilter = authLevel <= 3
      ? {
          $or: [
            { 'permissions.level': { $gte: authLevel } },
            { 'permissions.level': { $exists: false } }
          ]
        }
      : { 'permissions.level': { $gte: authLevel } };

    return {
      ...additionalFilter,
      ...levelFilter
    };
  }

  function canManagePermissionLevel(authUser, targetLevel) {
    const authLevel = getPermissionLevel(authUser);
    return typeof targetLevel === 'number' && authLevel !== null && targetLevel >= authLevel;
  }

  function requireUser(req, res, next) {
    if (config.enableApiTokenCheck === false) {
      req.tokenPayload = { bypassed: true };
      return next();
    }

    try {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ error: 'Missing token' });

      req.tokenPayload = jwt.verify(token, config.jwtSecret);
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  function getTokenUserId(payload) {
    const rawUserId = payload?.userId;
    if (!rawUserId) return null;
    if (typeof rawUserId === 'string') return rawUserId;
    if (typeof rawUserId === 'object' && rawUserId.$oid) return rawUserId.$oid;
    return `${rawUserId}`;
  }

  function normalizeStringArray(value) {
    if (Array.isArray(value)) {
      return value.map(x => `${x}`.trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value.split(',').map(x => x.trim()).filter(Boolean);
    }
    return [];
  }

  function normalizePermissionLevel(value, defaultLevel = 3) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultLevel;
  }

  function isValidPasswordLength(password) {
    return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
  }

  function passwordLengthError() {
    return `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`;
  }

  function sanitizeUser(user) {
    if (!user) return null;
    return {
      _id: user._id,
      username: user.local?.username || '',
      email: user.email || '',
      role: user.role || 'user',
      permissions: {
        level: typeof user.permissions?.level === 'number' ? user.permissions.level : 3
      },
      groups: Array.isArray(user.groups) ? user.groups : [],
      restrictions: Array.isArray(user.restrictions) ? user.restrictions : [],
      active: user.active !== false,
      createdAt: user.createdAt || null,
      updatedAt: user.updatedAt || null
    };
  }

  function buildUserUpdate(body, includePassword) {
    const update = {
      'local.username': `${body.username || ''}`.trim(),
      email: `${body.email || ''}`.trim(),
      role: `${body.role || 'user'}`.trim() || 'user',
      permissions: {
        level: normalizePermissionLevel(body.permissions?.level ?? body.permissionLevel)
      },
      groups: normalizeStringArray(body.groups),
      restrictions: normalizeStringArray(body.restrictions),
      active: body.active !== false,
      updatedAt: new Date()
    };

    if (includePassword && body.password) {
      update['local.password'] = bcrypt.hashSync(body.password, bcrypt.genSaltSync(10));
    }

    return update;
  }

  function signUserToken(user) {
    return jwt.sign(
      {
        userId: user._id,
        username: user.local?.username,
        role: user.role || 'user',
        permissions: {
          level: typeof user.permissions?.level === 'number' ? user.permissions.level : 3
        }
      },
      config.jwtSecret,
      { expiresIn: '24h' }
    );
  }

  router.get('/me', requireUser, async (req, res) => {
    try {
      const tokenUserId = getTokenUserId(req.tokenPayload);
      if (!tokenUserId) return res.status(401).json({ error: 'Invalid token payload' });

      const user = await userCollection.findOne({ _id: new ObjectId(tokenUserId) });
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.active === false) return res.status(403).json({ error: 'User account is inactive' });

      res.json({ user: sanitizeUser(user) });
    } catch (error) {
      logger?.error?.('Error fetching profile:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  router.put('/me', requireUser, async (req, res) => {
    try {
      const tokenUserId = getTokenUserId(req.tokenPayload);
      if (!tokenUserId) return res.status(401).json({ error: 'Invalid token payload' });

      const userId = new ObjectId(tokenUserId);
      const existingUser = await userCollection.findOne({ _id: userId });
      if (!existingUser) return res.status(404).json({ error: 'User not found' });
      if (existingUser.active === false) return res.status(403).json({ error: 'User account is inactive' });

      const username = `${req.body.username || ''}`.trim();
      const email = `${req.body.email || ''}`.trim();
      const password = `${req.body.password || ''}`;
      const currentPassword = `${req.body.currentPassword || ''}`;

      if (username.length < 4) {
        return res.status(400).json({ error: 'Username must be at least 4 characters' });
      }

      const duplicate = await userCollection.findOne({
        'local.username': username,
        _id: { $ne: userId }
      });
      if (duplicate) {
        return res.status(409).json({ error: 'That username is already taken' });
      }

      const update = {
        'local.username': username,
        email,
        updatedAt: new Date()
      };

      if (password) {
        if (!isValidPasswordLength(password)) {
          return res.status(400).json({ error: passwordLengthError() });
        }
        if (!currentPassword || !bcrypt.compareSync(currentPassword, existingUser.local?.password || '')) {
          return res.status(400).json({ error: 'Current password is required to change password' });
        }
        update['local.password'] = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
      }

      await userCollection.updateOne({ _id: userId }, { $set: update });
      const saved = await userCollection.findOne({ _id: userId });

      res.json({
        user: sanitizeUser(saved),
        token: signUserToken(saved)
      });
    } catch (error) {
      logger?.error?.('Error updating profile:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  router.get('/', requireUsersAccess, async (req, res) => {
    try {
      const users = await userCollection.find(getVisibleUserFilter(req.authUser))
        .sort({ 'local.username': 1 })
        .toArray();
      res.json({ users: users.map(sanitizeUser) });
    } catch (error) {
      logger?.error?.('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  router.post('/', requireUsersAccess, async (req, res) => {
    try {
      const username = `${req.body.username || ''}`.trim();
      const password = `${req.body.password || ''}`;
      const permissionLevel = normalizePermissionLevel(req.body.permissions?.level ?? req.body.permissionLevel);

      if (username.length < 4) {
        return res.status(400).json({ error: 'Username must be at least 4 characters' });
      }
      if (!isValidPasswordLength(password)) {
        return res.status(400).json({ error: passwordLengthError() });
      }
      if (!canManagePermissionLevel(req.authUser, permissionLevel)) {
        return res.status(403).json({ error: 'Cannot create a user with a higher permission level than your own' });
      }

      const existing = await userCollection.findOne({ 'local.username': username });
      if (existing) {
        return res.status(409).json({ error: 'That username is already taken' });
      }

      const now = new Date();
      const newUser = {
        local: {
          username,
          password: bcrypt.hashSync(password, bcrypt.genSaltSync(10))
        },
        email: `${req.body.email || ''}`.trim(),
        role: `${req.body.role || 'user'}`.trim() || 'user',
        permissions: {
          level: permissionLevel
        },
        groups: normalizeStringArray(req.body.groups),
        restrictions: normalizeStringArray(req.body.restrictions),
        active: req.body.active !== false,
        createdAt: now,
        updatedAt: now
      };

      const result = await userCollection.insertOne(newUser);
      const saved = await userCollection.findOne({ _id: result.insertedId });
      res.status(201).json({ user: sanitizeUser(saved) });
    } catch (error) {
      logger?.error?.('Error creating user:', error);
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  router.put('/:id', requireUsersAccess, async (req, res) => {
    try {
      const userId = new ObjectId(req.params.id);
      const username = `${req.body.username || ''}`.trim();
      const permissionLevel = normalizePermissionLevel(req.body.permissions?.level ?? req.body.permissionLevel);

      if (username.length < 4) {
        return res.status(400).json({ error: 'Username must be at least 4 characters' });
      }
      if (req.body.password && !isValidPasswordLength(`${req.body.password}`)) {
        return res.status(400).json({ error: passwordLengthError() });
      }
      if (!canManagePermissionLevel(req.authUser, permissionLevel)) {
        return res.status(403).json({ error: 'Cannot assign a higher permission level than your own' });
      }

      const existingUser = await userCollection.findOne(getVisibleUserFilter(req.authUser, { _id: userId }));
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      const duplicate = await userCollection.findOne({
        'local.username': username,
        _id: { $ne: userId }
      });
      if (duplicate) {
        return res.status(409).json({ error: 'That username is already taken' });
      }

      const update = buildUserUpdate(req.body, !!req.body.password);
      const result = await userCollection.updateOne(getVisibleUserFilter(req.authUser, { _id: userId }), { $set: update });
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const saved = await userCollection.findOne({ _id: userId });
      res.json({ user: sanitizeUser(saved) });
    } catch (error) {
      logger?.error?.('Error updating user:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  router.delete('/:id', requireUsersAccess, async (req, res) => {
    try {
      const userId = new ObjectId(req.params.id);
      const result = await userCollection.deleteOne(getVisibleUserFilter(req.authUser, { _id: userId }));

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ success: true, message: 'User deleted' });
    } catch (error) {
      logger?.error?.('Error deleting user:', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  return router;
};
