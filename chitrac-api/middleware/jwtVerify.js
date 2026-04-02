const jwt = require('jsonwebtoken');
const config = require('../modules/config');

/** Express middleware: verify JWT (same rules as /api/auth routes). */
function makeJwtVerifyMiddleware(server) {
  const logger = server.logger;

  function extractToken(req) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
    if (typeof req.query?.token === 'string') return req.query.token;
    if (typeof req.body?.token === 'string') return req.body.token;
    return null;
  }

  async function verifyPermanentToken(req, res, next, token, decoded) {
    try {
      const db = server.db;
      const authTokensCollection = db.collection('auth-tokens');
      const bcrypt = require('bcryptjs');

      const tokenDoc = await authTokensCollection.findOne({
        name: decoded.name,
        createdBy: decoded.createdBy,
        isActive: true
      });

      if (!tokenDoc) {
        return res.status(401).json({ valid: false, error: 'Token not found or inactive' });
      }

      const isValidToken = await bcrypt.compare(token, tokenDoc.hashedToken);
      if (!isValidToken) {
        return res.status(401).json({ valid: false, error: 'Invalid token' });
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

      next();
    } catch (err) {
      logger?.error?.('Error verifying permanent token:', err);
      return res.status(401).json({ valid: false, error: 'Token verification failed' });
    }
  }

  function verifyJwtMiddleware(req, res, next) {
    if (config.enableApiTokenCheck === false) {
      logger?.debug?.('API token check is disabled - bypassing authentication');
      req.tokenPayload = { bypassed: true };
      return next();
    }

    try {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ valid: false, error: 'Missing token' });
      const secret = config.jwtSecret;
      if (!secret) {
        logger?.warn?.('JWT secret not configured (config.jwtSecret)');
        return res.status(500).json({ valid: false, error: 'Server config error' });
      }

      const decoded = jwt.verify(token, secret);

      if (decoded.type === 'permanent') {
        verifyPermanentToken(req, res, next, token, decoded);
      } else {
        req.tokenPayload = decoded;
        next();
      }
    } catch (err) {
      return res.status(401).json({ valid: false, error: 'Invalid token' });
    }
  }

  return verifyJwtMiddleware;
}

module.exports = makeJwtVerifyMiddleware;
