const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const config = require('../../modules/config');
const { assertPermissionLevel, getPermissionLevel } = require('../../modules/permissions');
const { getEmailValidationError } = require('../../utils/emailValidation');
const { sendPasswordResetEmail } = require('../../modules/passwordResetEmail');

module.exports = function(server) {
  const router = express.Router();
  const db = server.db;
  const logger = server.logger;
  const userCollection = db.collection(config.userCollectionName);
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

  function getRoleOptions() {
    return (config.userPermissionsLevels || []).map((name, level) => ({
      name: `${name}`.trim(),
      level
    }));
  }

  function resolveRole(role) {
    const requestedRole = `${role || ''}`.trim().toLowerCase();
    return getRoleOptions().find(option => option.name.toLowerCase() === requestedRole) || null;
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

  function isValidPasswordLength(password) {
    return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
  }

  function passwordLengthError() {
    return `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`;
  }

  function normalizeUserTimestamps(user) {
    const now = new Date();
    const created = toDateValue(user?.timestamps?.create) || toDateValue(user?.createdAt) || now;
    const active = user?.timestamps?.active || created;
    const updated = toDateValue(user?.timestamps?.update) || toDateValue(user?.updatedAt) || created;

    return {
      create: created,
      active: toDateValue(active) || created,
      update: updated
    };
  }

  function stampUserUpdate(existingUser) {
    return {
      ...normalizeUserTimestamps(existingUser),
      update: new Date()
    };
  }

  function initUserTimestamps() {
    const now = new Date();
    return {
      create: now,
      active: now,
      update: now
    };
  }

  function toDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function sanitizeUser(user) {
    if (!user) return null;
    const timestamps = normalizeUserTimestamps(user);
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
      timestamps,
      createdAt: timestamps.create || null,
      updatedAt: timestamps.update || null
    };
  }

  function buildUserUpdate(body, existingUser, roleOption) {
    const update = {
      'local.username': `${body.username || ''}`.trim(),
      email: `${body.email || ''}`.trim(),
      role: roleOption.name,
      permissions: {
        level: roleOption.level
      },
      groups: normalizeStringArray(existingUser.groups),
      restrictions: normalizeStringArray(existingUser.restrictions),
      active: body.active !== false,
      timestamps: stampUserUpdate(existingUser)
    };

    if (body.password) {
      update['local.password'] = bcrypt.hashSync(`${body.password}`, bcrypt.genSaltSync(10));
    }

    return update;
  }

  function hashResetToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
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
      const emailError = getEmailValidationError(email);
      if (emailError) {
        return res.status(400).json({ error: emailError });
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
        timestamps: stampUserUpdate(existingUser)
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
      res.json({
        users: users.map(sanitizeUser),
        roles: getRoleOptions()
      });
    } catch (error) {
      logger?.error?.('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  router.post('/', requireUsersAccess, async (req, res) => {
    try {
      const username = `${req.body.username || ''}`.trim();
      const password = `${req.body.password || ''}`;
      const email = `${req.body.email || ''}`.trim();
      const roleOption = resolveRole(req.body.role);

      if (username.length < 4) {
        return res.status(400).json({ error: 'Username must be at least 4 characters' });
      }
      const emailError = getEmailValidationError(email);
      if (emailError) {
        return res.status(400).json({ error: emailError });
      }
      if (!isValidPasswordLength(password)) {
        return res.status(400).json({ error: passwordLengthError() });
      }
      if (password !== `${req.body.confirmPassword || ''}`) {
        return res.status(400).json({ error: 'Passwords do not match' });
      }
      if (!roleOption) {
        return res.status(400).json({ error: 'Select a valid role' });
      }
      if (!canManagePermissionLevel(req.authUser, roleOption.level)) {
        return res.status(403).json({ error: 'Cannot create a user with a higher permission level than your own' });
      }

      const existing = await userCollection.findOne({ 'local.username': username });
      if (existing) {
        return res.status(409).json({ error: 'That username is already taken' });
      }

      const timestamps = initUserTimestamps();
      const newUser = {
        local: {
          username,
          password: bcrypt.hashSync(password, bcrypt.genSaltSync(10))
        },
        email,
        role: roleOption.name,
        permissions: {
          level: roleOption.level
        },
        groups: [],
        restrictions: [],
        active: req.body.active !== false,
        timestamps
      };

      const result = await userCollection.insertOne(newUser);
      const saved = await userCollection.findOne({ _id: result.insertedId });
      res.status(201).json({ user: sanitizeUser(saved) });
    } catch (error) {
      logger?.error?.('Error creating user:', error);
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  router.post('/password-reset/complete', async (req, res) => {
    try {
      const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
      const password = typeof req.body.password === 'string' ? req.body.password : '';

      if (!token || !isValidPasswordLength(password)) {
        return res.status(400).json({
          error: token ? passwordLengthError() : 'This password reset link is invalid or has expired'
        });
      }

      const now = new Date();
      const result = await userCollection.updateOne(
        {
          'passwordReset.tokenHash': hashResetToken(token),
          'passwordReset.expiresAt': { $gt: now },
          active: { $ne: false }
        },
        {
          $set: {
            'local.password': bcrypt.hashSync(password, bcrypt.genSaltSync(10)),
            'timestamps.update': now
          },
          $unset: { passwordReset: '' }
        }
      );

      if (result.modifiedCount !== 1) {
        return res.status(400).json({ error: 'This password reset link is invalid or has expired' });
      }

      logger?.info?.('User password reset completed');
      return res.json({ success: true, message: 'Password updated' });
    } catch (error) {
      logger?.error?.('Error completing password reset:', error);
      return res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  router.post('/:id/password-reset', requireUsersAccess, async (req, res) => {
    let userId;
    let tokenHash;

    try {
      userId = new ObjectId(req.params.id);
      const existingUser = await userCollection.findOne(getVisibleUserFilter(req.authUser, { _id: userId }));
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (existingUser.active === false) {
        return res.status(400).json({ error: 'Cannot reset the password for an inactive user' });
      }

      const email = `${existingUser.email || ''}`.trim();
      const emailError = getEmailValidationError(email);
      if (!email || emailError) {
        return res.status(400).json({ error: 'User must have a valid email address' });
      }
      if (!config.appBaseUrl) {
        return res.status(503).json({ error: 'APP_BASE_URL is not configured on the server' });
      }
      const lastRequestedAt = toDateValue(existingUser.passwordReset?.requestedAt);
      if (lastRequestedAt && Date.now() - lastRequestedAt.getTime() < 60 * 1000) {
        return res.status(429).json({ error: 'Please wait before sending another password reset email' });
      }

      const token = crypto.randomBytes(32).toString('base64url');
      tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + config.passwordResetExpirationMs);
      const now = new Date();
      const requestedBy = req.authUser?._id || null;

      await userCollection.updateOne(
        getVisibleUserFilter(req.authUser, { _id: userId }),
        {
          $set: {
            passwordReset: {
              tokenHash,
              expiresAt,
              requestedAt: now,
              requestedBy
            },
            'timestamps.update': now
          }
        }
      );

      const resetUrl = `${config.appBaseUrl}/ng/reset-password?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail({
        to: email,
        username: existingUser.local?.username || 'ChiTrac user',
        resetUrl,
        expiresInMinutes: config.passwordResetExpirationMinutes
      });

      logger?.info?.(`Password reset email sent for user ${userId}`);
      return res.json({ success: true, message: 'Password reset email sent' });
    } catch (error) {
      if (userId && tokenHash) {
        const now = new Date();
        await userCollection.updateOne(
          { _id: userId, 'passwordReset.tokenHash': tokenHash },
          {
            $set: { 'timestamps.update': now },
            $unset: { passwordReset: '' }
          }
        ).catch(cleanupError => logger?.error?.('Failed to clean up password reset token:', cleanupError));
      }
      logger?.error?.('Error sending password reset email:', error);
      const status = error?.code === 'SMTP_CONFIG' ? 503 : 500;
      return res.status(status).json({
        error: status === 503 ? 'Email is not configured on the server' : 'Failed to send password reset email'
      });
    }
  });

  router.put('/:id', requireUsersAccess, async (req, res) => {
    try {
      const userId = new ObjectId(req.params.id);
      const username = `${req.body.username || ''}`.trim();
      const email = `${req.body.email || ''}`.trim();
      const password = `${req.body.password || ''}`;
      const roleOption = resolveRole(req.body.role);

      if (username.length < 4) {
        return res.status(400).json({ error: 'Username must be at least 4 characters' });
      }
      const emailError = getEmailValidationError(email);
      if (emailError) {
        return res.status(400).json({ error: emailError });
      }
      if (!roleOption) {
        return res.status(400).json({ error: 'Select a valid role' });
      }
      if (!canManagePermissionLevel(req.authUser, roleOption.level)) {
        return res.status(403).json({ error: 'Cannot assign a higher permission level than your own' });
      }
      if (password && !isValidPasswordLength(password)) {
        return res.status(400).json({ error: passwordLengthError() });
      }
      if (password && password !== `${req.body.confirmPassword || ''}`) {
        return res.status(400).json({ error: 'Passwords do not match' });
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

      const update = buildUserUpdate(req.body, existingUser, roleOption);
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
