const express = require("express");
const jwt = require("jsonwebtoken");
const config = require("../../modules/config");
const certificates = require("../../modules/certificates");
const { ObjectId } = require("mongodb");
const { assertPermissionLevel } = require("../../modules/permissions");
const timestampsSchema = require("../../schemas/timestampsSchema");
const authTokenSchema = require('../../schemas/auth-token');
const { randomUUID } = require('node:crypto');
const { tokenHashInput } = require('../../utils/apiTokenHash');
const { controllers, controllerIds, validateAllowedControllers } = require('../../modules/apiTokenControllers');
const {
  createVerifyJwtMiddleware,
  normalizeTokenUserId
} = require("../../utils/authMiddleware");

function buildTokenTimestamps(token, fallbackDate = new Date()) {
  const timestamps = token.timestamps
    ? timestampsSchema.utils.normalize(token.timestamps)
    : timestampsSchema.utils.stampInit(token.createdAt || fallbackDate);

  if (!timestamps.inactive && token.deactivatedAt) {
    return timestampsSchema.utils.stampInactive(timestamps, token.deactivatedAt);
  }

  return timestamps;
}

function isTokenDeactivated(token) {
  return token.isActive === false || Boolean(token.deactivatedAt || token.timestamps?.inactive);
}

function sanitizeToken(token, isActive = !isTokenDeactivated(token)) {
  return {
    id: token._id,
    name: token.name,
    description: token.description,
    timestamps: buildTokenTimestamps(token),
    isActive,
    lastUsed: token.lastUsed,
    usageCount: token.usageCount,
    allowedControllers: validateAllowedControllers(token.allowedControllers) ? token.allowedControllers : []
  };
}

function partitionTokens(tokens) {
  return tokens.reduce((result, token) => {
    if (isTokenDeactivated(token)) {
      result.deactivatedTokens.push(sanitizeToken(token, false));
    } else {
      result.tokens.push(sanitizeToken(token, true));
    }
    return result;
  }, { tokens: [], deactivatedTokens: [] });
}

module.exports = function (server) {
  const router = express.Router();
  const logger = server.logger;
  const verifyJwtMiddleware = createVerifyJwtMiddleware(server);

  function requirePermissionLevel(requiredLevel) {
    return async function(req, res, next) {
      if (req.tokenPayload?.bypassed) return next();
      if (req.tokenPayload?.type === 'permanent') {
        return res.status(403).json({ error: 'A signed-in user is required' });
      }

      try {
        const userId = normalizeTokenUserId(req.tokenPayload?.userId || req.tokenPayload?.createdBy);
        if (!userId) return res.status(401).json({ error: "Invalid token payload" });

        const user = await server.db.collection(config.userCollectionName).findOne({ _id: new ObjectId(userId) });
        assertPermissionLevel(user, requiredLevel);
        req.authUser = user;
        return next();
      } catch (err) {
        logger?.error?.("Permission check failed:", err);
        return res.status(err.status || 403).json({ error: err.message || "Insufficient permissions" });
      }
    };
  }

  router.get("/tokenTest", verifyJwtMiddleware, (req, res) => {
    res.json({ valid: true, payload: req.tokenPayload });
  });

  router.post("/ssl/generate-certificate", verifyJwtMiddleware, requirePermissionLevel(0), async (req, res) => {
    try {
      const result = await certificates.generateSelfSignedCertificate(config, {
        commonName: req.body?.commonName,
        days: req.body?.days
      });

      res.json({
        success: true,
        message: "SSL certificate generated",
        certificatesDir: result.certificatesDir,
        keyFile: config.httpsKeyFile,
        certFile: config.httpsCertFile
      });
    } catch (err) {
      logger?.error?.("Error generating SSL certificate:", err);
      res.status(err.status || 500).json({ error: err.message || "Failed to generate SSL certificate" });
    }
  });

  // Test endpoint to generate JWT tokens for testing
  router.post("/generateTestToken", verifyJwtMiddleware, requirePermissionLevel(0), (req, res) => {
    try {
      const { username = "testuser", role = "user" } = req.body;
      const token = jwt.sign(
        { 
          userId: "test-user-id",
          username: username,
          role: role
        },
        config.jwtSecret,
        { expiresIn: '24h' }
      );
      
      res.json({ 
        token: token,
        payload: { username, role, userId: "test-user-id" }
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to generate token" });
    }
  });

  // API token management is restricted to the same permission level as the settings page.
  router.post("/createPermanentToken", verifyJwtMiddleware, requirePermissionLevel(1), async (req, res) => {
    try {
      const { name, description = "" } = req.body;
      
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: "Token name is required" });
      }
      if (typeof description !== 'string') {
        return res.status(400).json({ error: 'Description must be a string' });
      }

      const db = server.db;
      const authTokensCollection = db.collection('auth-tokens');

      // Check if token name already exists
      const existingToken = await authTokensCollection.findOne({ 
        name: name.trim(),
        isActive: true 
      });
      
      if (existingToken) {
        return res.status(409).json({ error: "Token name already exists" });
      }

      const createdBy = normalizeTokenUserId(req.authUser?._id || req.tokenPayload.userId);

      // Generate permanent token (no expiry)
      const token = jwt.sign(
        { 
          type: 'permanent',
          name: name.trim(),
          createdBy
        },
        config.jwtSecret,
        { jwtid: randomUUID() }
        // No expiresIn - permanent token
      );

      // Hash the token for storage (security)
      const bcrypt = require('bcryptjs');
      const hashedToken = await bcrypt.hash(tokenHashInput(token, 2), 10);

      // Store token info in database
      const now = new Date();
      const tokenDoc = {
        name: name.trim(),
        description: description.trim(),
        hashedToken: hashedToken,
        hashedTokenVersion: 2,
        createdBy,
        createdByUsername: req.authUser?.username || req.tokenPayload.username,
        timestamps: timestampsSchema.utils.stampInit(now),
        isActive: true,
        lastUsed: null,
        usageCount: 0,
        allowedControllers: []
      };

      if (!authTokenSchema.validate(tokenDoc)) throw new Error('Invalid API token record');

      const result = await authTokensCollection.insertOne(tokenDoc);

      res.status(201).json({
        success: true,
        token: token, // Return the actual token (only time it's shown)
        tokenInfo: {
          id: result.insertedId,
          name: tokenDoc.name,
          description: tokenDoc.description,
          timestamps: tokenDoc.timestamps,
          allowedControllers: tokenDoc.allowedControllers
        }
      });

    } catch (err) {
      logger?.error?.("Error creating permanent token:", err);
      res.status(500).json({ error: "Failed to create permanent token" });
    }
  });

  // List all permanent tokens managed by this server.
  router.get("/tokens", verifyJwtMiddleware, requirePermissionLevel(1), async (req, res) => {
    try {
      const db = server.db;
      const authTokensCollection = db.collection('auth-tokens');

      const tokenRecords = await authTokensCollection
        .find({})
        .sort({ "timestamps.create": -1, createdAt: -1 })
        .toArray();

      res.json({ ...partitionTokens(tokenRecords), controllers });

    } catch (err) {
      logger?.error?.("Error fetching tokens:", err);
      res.status(500).json({ error: "Failed to fetch tokens" });
    }
  });

  router.put('/tokens/:id/controllers', verifyJwtMiddleware, requirePermissionLevel(1), async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid token id' });
    const allowedControllers = req.body?.allowedControllers;
    if (!validateAllowedControllers(allowedControllers) ||
        Object.keys(req.body).some(key => key !== 'allowedControllers')) {
      return res.status(400).json({ error: 'allowedControllers must contain unique supported controller IDs' });
    }
    try {
      const collection = server.db.collection('auth-tokens');
      const _id = new ObjectId(req.params.id);
      const token = await collection.findOne({ _id });
      if (!token) return res.status(404).json({ error: 'Token not found' });
      if (isTokenDeactivated(token)) return res.status(409).json({ error: 'Token is inactive' });
      const orderedControllers = controllerIds.filter(id => allowedControllers.includes(id));
      const result = await collection.updateOne(
        { _id, isActive: true, 'timestamps.inactive': { $exists: false }, deactivatedAt: { $exists: false } },
        { $set: { allowedControllers: orderedControllers, 'timestamps.update': new Date() } }
      );
      if (!result.matchedCount) return res.status(409).json({ error: 'Token is no longer active' });
      return res.json({ success: true, allowedControllers: orderedControllers });
    } catch (err) {
      logger?.error?.('Error updating API token controller access:', err);
      return res.status(500).json({ error: 'Failed to update controller access' });
    }
  });

  // Deactivate permanent token
  router.delete("/tokens/:id", verifyJwtMiddleware, requirePermissionLevel(1), async (req, res) => {
    try {
      const { id } = req.params;
      const db = server.db;
      const authTokensCollection = db.collection('auth-tokens');
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid token id" });
      }

      const tokenId = new ObjectId(id);
      const now = new Date();
      const tokenDoc = await authTokensCollection.findOne({
        _id: tokenId
      });

      if (!tokenDoc) {
        return res.status(404).json({ error: "Token not found" });
      }

      const timestamps = timestampsSchema.utils.stampInactive(buildTokenTimestamps(tokenDoc, now), now);

      const result = await authTokensCollection.updateOne(
        { 
          _id: tokenId
        },
        { 
          $set: { 
            isActive: false,
            timestamps
          },
          $unset: {
            deactivatedAt: ""
          }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "Token not found" });
      }

      res.json({ success: true, message: "Token deactivated" });

    } catch (err) {
      logger?.error?.("Error deactivating token:", err);
      res.status(500).json({ error: "Failed to deactivate token" });
    }
  });

  // Get user's theme preference
  router.get("/user/theme", (req, res) => {
    res.redirect(307, `/api/preferences/user/theme`);
  });

  // Save user's theme preference
  router.put("/user/theme", (req, res) => {
    res.redirect(307, `/api/preferences/user/theme`);
  });

  return router;
};

module.exports.partitionTokens = partitionTokens;
