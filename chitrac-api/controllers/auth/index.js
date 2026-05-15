const express = require("express");
const jwt = require("jsonwebtoken");
const config = require("../../modules/config");
const certificates = require("../../modules/certificates");
const { ObjectId } = require("mongodb");
const { assertPermissionLevel } = require("../../modules/permissions");

module.exports = function (server) {
  const router = express.Router();
  const logger = server.logger;

  function extractToken(req) {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();
    if (typeof req.query?.token === "string") return req.query.token;
    if (typeof req.body?.token === "string") return req.body.token;
    return null;
  }

  function normalizeTokenUserId(rawUserId) {
    if (!rawUserId) return null;
    if (typeof rawUserId === "string") return rawUserId;
    if (typeof rawUserId === "object" && rawUserId.$oid) return rawUserId.$oid;
    return `${rawUserId}`;
  }

  function verifyJwtMiddleware(req, res, next) {
    // Check if API token check is disabled via environment variable
    if (config.enableApiTokenCheck === false) {
      logger?.debug?.("API token check is disabled - bypassing authentication");
      req.tokenPayload = { bypassed: true };
      return next();
    }

    try {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ valid: false, error: "Missing token" });
      const secret = config.jwtSecret;
      if (!secret) {
        logger?.warn?.("JWT secret not configured (config.jwtSecret)");
        return res.status(500).json({ valid: false, error: "Server config error" });
      }
      
      const decoded = jwt.verify(token, secret);
      
      // Check if it's a permanent token
      if (decoded.type === 'permanent') {
        // For permanent tokens, verify they exist in database and are active
        verifyPermanentToken(req, res, next, token, decoded);
      } else {
        // Regular session token
        req.tokenPayload = decoded;
        next();
      }
    } catch (err) {
      return res.status(401).json({ valid: false, error: "Invalid token" });
    }
  }

  async function verifyPermanentToken(req, res, next, token, decoded) {
    try {
      const db = server.db;
      const authTokensCollection = db.collection('auth-tokens');
      const bcrypt = require('bcryptjs');

      // Find token in database
      const tokenDoc = await authTokensCollection.findOne({
        name: decoded.name,
        createdBy: decoded.createdBy,
        isActive: true
      });

      if (!tokenDoc) {
        return res.status(401).json({ valid: false, error: "Token not found or inactive" });
      }

      // Verify the token matches the stored hash
      const isValidToken = await bcrypt.compare(token, tokenDoc.hashedToken);
      if (!isValidToken) {
        return res.status(401).json({ valid: false, error: "Invalid token" });
      }

      // Update usage statistics
      await authTokensCollection.updateOne(
        { _id: tokenDoc._id },
        { 
          $set: { lastUsed: new Date() },
          $inc: { usageCount: 1 }
        }
      );

      // Set token payload for the request
      req.tokenPayload = {
        ...decoded,
        tokenId: tokenDoc._id,
        tokenName: tokenDoc.name
      };

      next();
    } catch (err) {
      logger?.error?.("Error verifying permanent token:", err);
      return res.status(401).json({ valid: false, error: "Token verification failed" });
    }
  }

  function requirePermissionLevel(requiredLevel) {
    return async function(req, res, next) {
      if (req.tokenPayload?.bypassed) return next();

      try {
        const userId = normalizeTokenUserId(req.tokenPayload?.userId || req.tokenPayload?.createdBy);
        if (!userId) return res.status(401).json({ error: "Invalid token payload" });

        const user = await server.db.collection('user').findOne({ _id: new ObjectId(userId) });
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
          createdBy: req.tokenPayload.userId,
          createdAt: new Date().toISOString()
        },
        config.jwtSecret
        // No expiresIn - permanent token
      );

      // Hash the token for storage (security)
      const bcrypt = require('bcryptjs');
      const hashedToken = await bcrypt.hash(token, 10);

      // Store token info in database
      const tokenDoc = {
        name: name.trim(),
        description: description.trim(),
        hashedToken: hashedToken,
        createdBy: req.tokenPayload.userId,
        createdByUsername: req.tokenPayload.username,
        createdAt: new Date(),
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
          createdAt: tokenDoc.createdAt
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
        .sort({ createdAt: -1 })
        .toArray();

      // Remove hashed tokens from response
      const sanitizedTokens = tokens.map(token => ({
        id: token._id,
        name: token.name,
        description: token.description,
        createdAt: token.createdAt,
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

      const result = await authTokensCollection.updateOne(
        { 
          _id: new ObjectId(id),
          createdBy: req.tokenPayload.userId 
        },
        { 
          $set: { 
            isActive: false,
            deactivatedAt: new Date()
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
