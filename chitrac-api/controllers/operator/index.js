const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const config = require('../../modules/config');

module.exports = function (server) { return constructor(server); };

function constructor(server) {
  const db = server.db;
  const collection = db.collection('operator');
  const xmlParser = server.xmlParser;
  const configService = require('../../services/mongo/');
  const logger = server.logger;

  // Ensure unique index once at startup
  collection.createIndex({ code: 1 }, { unique: true }).catch(() => {});

  // JWT verification middleware
  function verifyJwtMiddleware(req, res, next) {
    try {
      const authHeader = req.headers["authorization"] || req.headers["Authorization"];
      let token = null;
      
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7).trim();
      } else if (req.query?.token) {
        token = req.query.token;
      } else if (req.body?.token) {
        token = req.body.token;
      }
      
      if (!token) {
        return res.status(401).json({ valid: false, error: "Missing token" });
      }
      
      const secret = config.jwtSecret;
      if (!secret) {
        logger?.warn?.("JWT secret not configured (config.jwtSecret)");
        return res.status(500).json({ valid: false, error: "Server config error" });
      }
      
      const decoded = jwt.verify(token, secret);
      req.tokenPayload = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ valid: false, error: "Invalid token" });
    }
  }

  async function getOperatorXML(req, res, next) {
    try {
      res.set('Content-Type', 'text/xml');
      const ops = await configService.getConfiguration(
        collection, {}, { code: '$code', name: '$name.full', _id: 0 }
      );
      res.send(await xmlParser.xmlArrayBuilder('operator', ops, false));
    } catch (e) { next(e); }
  }

  async function getOperator(req, res, next) {
    try { 
      // Check for filterTestOperators query parameter
      const filterTestOperators = req.query.filterTestOperators === 'true';
      
      // Build query object - filter out operators with code > 500000 if requested
      const query = filterTestOperators ? { code: { $lte: 500000 } } : {};
      
      res.json(await configService.getConfiguration(collection, query)); 
    }
    catch (e) { next(e); }
  }

  // Create
  async function createOperator(req, res, next) {
    try {
      const body = { ...req.body };
      if (body._id) delete body._id;           // new doc
      // unique by 'code'
      const out = await configService.upsertConfiguration(collection, body, true, 'code');
      res.status(201).json(out);
    } catch (e) { next(e); }
  }

  // Update by id (id-aware, preserves uniqueness on 'code' excluding self)
  async function upsertOperator(req, res, next) {
    try {
      const id = req.params.id || null;
      const updates = { ...req.body };
      if (updates._id) delete updates._id;

      // Pass {_id:id,...updates} so configService can do:
      // findOne({ code: updates.code, _id: { $ne: id } }) → 409 if exists
      const out = await configService.upsertConfiguration(
        collection,
        id ? { _id: id, ...updates } : updates,
        true,
        'code'
      );
      res.json(out);
    } catch (e) { next(e); }
  }

  async function deleteOperator(req, res, next) {
    try { res.json(await configService.deleteConfiguration(collection, req.params.id)); }
    catch (e) { next(e); }
  }

  // Get next available operator ID
  async function getNewOperatorId(req, res, next) {
    try {
      // Find the highest code value under 600000
      const result = await collection
        .find({ code: { $lt: 600000 } })
        .sort({ code: -1 })
        .limit(1)
        .toArray();
      
      // If no operators exist, start from 100000, otherwise add 1 to the highest
      const nextId = result.length > 0 ? result[0].code + 1 : 100000;
      
      res.json({ code: nextId });
    } catch (e) { next(e); }
  }

  // Routes
  router.get('/operator/config/xml', getOperatorXML);
  router.get('/operator/config', getOperator);
  router.get('/operator/new-id', getNewOperatorId);

  // Protected routes - require JWT token
  router.post('/operator/config', verifyJwtMiddleware, createOperator);
  router.put('/operator/config/:id', verifyJwtMiddleware, upsertOperator);
  router.delete('/operator/config/:id', verifyJwtMiddleware, deleteOperator);

  return router;
}