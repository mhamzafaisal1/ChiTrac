const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const config = require("../modules/config");

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

      if (!tokenDoc) {
        return res.status(401).json({ valid: false, error: "Token not found or inactive" });
      }

      const isValidToken = await bcrypt.compare(token, tokenDoc.hashedToken);
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
        tokenName: tokenDoc.name
      };

      return next();
    } catch (err) {
      logger?.error?.("Error verifying permanent token:", err);
      return res.status(401).json({ valid: false, error: "Token verification failed" });
    }
  }

  return function verifyJwtMiddleware(req, res, next) {
    if (config.enableApiTokenCheck === false) {
      logger?.debug?.("API token check is disabled - bypassing authentication");
      req.tokenPayload = { bypassed: true };
      return next();
    }

    try {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ valid: false, error: "Missing token" });

      if (!config.jwtSecret) {
        logger?.warn?.("JWT secret not configured (config.jwtSecret)");
        return res.status(500).json({ valid: false, error: "Server config error" });
      }

      const decoded = jwt.verify(token, config.jwtSecret);
      if (decoded.type === "permanent") {
        return verifyPermanentToken(req, res, next, token, decoded);
      }

      req.tokenPayload = decoded;
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
