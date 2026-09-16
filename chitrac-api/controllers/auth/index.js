const express = require("express");
const jwt = require("jsonwebtoken");
const config = require("../../modules/config");
const certificates = require("../../modules/certificates");
const { ObjectId } = require("mongodb");
const { assertPermissionLevel } = require("../../modules/permissions");
const timestampsSchema = require("../../schemas/timestampsSchema");
const {
  createVerifyJwtMiddleware,
  normalizeTokenUserId
} = require("../../utils/authMiddleware");

module.exports = function (server) {
  const router = express.Router();
  const logger = server.logger;
  const verifyJwtMiddleware = createVerifyJwtMiddleware(server);

  function buildTokenTimestamps(token, fallbackDate = new Date()) {
    if (token.timestamps) return timestampsSchema.utils.normalize(token.timestamps);
    return timestampsSchema.utils.stampInit(token.createdAt || fallbackDate);
  }

  function requirePermissionLevel(requiredLevel) {
    return async function(req, res, next) {
      if (req.tokenPayload?.bypassed) return next();

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
  router.post("/generateTestToken", (req, res) => {
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

  // Create permanent token (requires JWT authentication)
  router.post("/createPermanentToken", verifyJwtMiddleware, async (req, res) => {
    try {
      const { name, description = "" } = req.body;
      
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: "Token name is required" });
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

      // Generate permanent token (no expiry)
      const token = jwt.sign(
        { 
          type: 'permanent',
          name: name.trim(),
          createdBy: req.tokenPayload.userId
        },
        config.jwtSecret
        // No expiresIn - permanent token
      );

      // Hash the token for storage (security)
      const bcrypt = require('bcryptjs');
      const hashedToken = await bcrypt.hash(token, 10);

      // Store token info in database
      const now = new Date();
      const tokenDoc = {
        name: name.trim(),
        description: description.trim(),
        hashedToken: hashedToken,
        createdBy: req.tokenPayload.userId,
        createdByUsername: req.tokenPayload.username,
        timestamps: timestampsSchema.utils.stampInit(now),
        isActive: true,
        lastUsed: null,
        usageCount: 0
      };

      const result = await authTokensCollection.insertOne(tokenDoc);

      res.status(201).json({
        success: true,
        token: token, // Return the actual token (only time it's shown)
        tokenInfo: {
          id: result.insertedId,
          name: tokenDoc.name,
          description: tokenDoc.description,
          timestamps: tokenDoc.timestamps
        }
      });

    } catch (err) {
      logger?.error?.("Error creating permanent token:", err);
      res.status(500).json({ error: "Failed to create permanent token" });
    }
  });

  // List user's created permanent tokens
  router.get("/tokens", verifyJwtMiddleware, async (req, res) => {
    try {
      const db = server.db;
      const authTokensCollection = db.collection('auth-tokens');

      const tokens = await authTokensCollection
        .find({ 
          createdBy: req.tokenPayload.userId,
          isActive: true 
        })
        .sort({ "timestamps.create": -1, createdAt: -1 })
        .toArray();

      // Remove hashed tokens from response
      const sanitizedTokens = tokens.map(token => ({
        id: token._id,
        name: token.name,
        description: token.description,
        timestamps: buildTokenTimestamps(token),
        lastUsed: token.lastUsed,
        usageCount: token.usageCount
      }));

      res.json({ tokens: sanitizedTokens });

    } catch (err) {
      logger?.error?.("Error fetching tokens:", err);
      res.status(500).json({ error: "Failed to fetch tokens" });
    }
  });

  // Deactivate permanent token
  router.delete("/tokens/:id", verifyJwtMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const db = server.db;
      const authTokensCollection = db.collection('auth-tokens');
      const ObjectId = require('mongodb').ObjectId;
      const now = new Date();
      const tokenDoc = await authTokensCollection.findOne({
        _id: new ObjectId(id),
        createdBy: req.tokenPayload.userId
      });

      if (!tokenDoc) {
        return res.status(404).json({ error: "Token not found" });
      }

      const timestamps = timestampsSchema.utils.stampInactive(buildTokenTimestamps(tokenDoc, now), now);

      const result = await authTokensCollection.updateOne(
        { 
          _id: new ObjectId(id),
          createdBy: req.tokenPayload.userId 
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
