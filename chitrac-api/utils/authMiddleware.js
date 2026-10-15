const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const config = require("../modules/config");
const { ObjectId } = require('mongodb');
const verifiedRequest = Symbol('verifiedApiAuthentication');
const { tokenHashInput } = require('./apiTokenHash');

function extractToken(req) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();
  if (typeof req.headers["x-api-key"] === "string") return req.headers["x-api-key"].trim();
  if (typeof req.headers["x-api-token"] === "string") return req.headers["x-api-token"].trim();
  if (typeof req.headers["api-key"] === "string") return req.headers["api-key"].trim();
  if (typeof req.headers["apikey"] === "string") return req.headers["apikey"].trim();
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

function createVerifyJwtMiddleware(server) {
  const logger = server.logger;

  async function verifyPermanentToken(req, res, next, token, decoded) {
    try {
      const authTokensCollection = server.db.collection("auth-tokens");
      const tokenDoc = await authTokensCollection.findOne({
        name: decoded.name,
        createdBy: decoded.createdBy,
        isActive: true
      });

      if (!tokenDoc || tokenDoc.deactivatedAt || tokenDoc.timestamps?.inactive) {
        return res.status(401).json({ valid: false, error: "Token not found or inactive" });
      }

      if (tokenDoc.hashedTokenVersion != null && ![1, 2].includes(tokenDoc.hashedTokenVersion)) {
        return res.status(401).json({ valid: false, error: 'Invalid token record' });
      }
      const isValidToken = await bcrypt.compare(tokenHashInput(token, tokenDoc.hashedTokenVersion), tokenDoc.hashedToken);
      if (!isValidToken) {
        return res.status(401).json({ valid: false, error: "Invalid token" });
      }

      await authTokensCollection.updateOne(
        { _id: tokenDoc._id },
        {
          $set: { lastUsed: new Date() },
          $inc: { usageCount: 1 }
        }
      );

      req.tokenPayload = {
        ...decoded,
        tokenId: tokenDoc._id,
        tokenName: tokenDoc.name,
        allowedControllers: tokenDoc.allowedControllers
      };
      req[verifiedRequest] = true;

      return next();
    } catch (err) {
      logger?.error?.("Error verifying permanent token:", err);
      return res.status(401).json({ valid: false, error: "Token verification failed" });
    }
  }

  return async function verifyJwtMiddleware(req, res, next) {
    if (req[verifiedRequest]) return next();
    if (config.enableApiTokenCheck === false) {
      logger?.debug?.("API token check is disabled - bypassing authentication");
      req.tokenPayload = { bypassed: true };
      return next();
    }

    try {
      const token = extractToken(req);
      if (!token && !req.isAuthenticated?.()) {
        return res.status(401).json({ valid: false, error: "Missing token" });
      }

      if (!config.jwtSecret) {
        logger?.warn?.("JWT secret not configured (config.jwtSecret)");
        return res.status(500).json({ valid: false, error: "Server config error" });
      }

      const decoded = token ? jwt.verify(token, config.jwtSecret) : { userId: String(req.user._id) };
      if (decoded.type === "permanent") {
        return verifyPermanentToken(req, res, next, token, decoded);
      }

      const userId = normalizeTokenUserId(decoded.userId);
      if (decoded.type || !userId || !ObjectId.isValid(userId)) {
        return res.status(401).json({ valid: false, error: 'Invalid user token' });
      }
      const user = await server.db.collection(config.userCollectionName).findOne({ _id: new ObjectId(userId) });
      if (!user || user.active === false) {
        return res.status(401).json({ valid: false, error: 'User not found or inactive' });
      }
      req.authUser = user;
      req.tokenPayload = decoded;
      req[verifiedRequest] = true;
      return next();
    } catch (err) {
      return res.status(401).json({ valid: false, error: "Invalid token" });
    }
  };
}

module.exports = {
  createVerifyJwtMiddleware,
  extractToken,
  normalizeTokenUserId
};
