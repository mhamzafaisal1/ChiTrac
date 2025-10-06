const express = require("express");
const jwt = require("jsonwebtoken");
const config = require("../../modules/config");

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

  function verifyJwtMiddleware(req, res, next) {
    try {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ valid: false, error: "Missing token" });
      const secret = config.jwtSecret;
      if (!secret) {
        logger?.warn?.("JWT secret not configured (config.jwtSecret)");
        return res.status(500).json({ valid: false, error: "Server config error" });
      }
      req.tokenPayload = jwt.verify(token, secret);
      next();
    } catch (err) {
      return res.status(401).json({ valid: false, error: "Invalid token" });
    }
  }

  router.get("/tokenTest", verifyJwtMiddleware, (req, res) => {
    res.json({ valid: true, payload: req.tokenPayload });
  });

  return router;
};
