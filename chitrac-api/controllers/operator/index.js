const express = require('express');
const router = express.Router();

module.exports = function (server) { return constructor(server); };

function constructor(server) {
  const db = server.db;
  const collection = db.collection('operator');
  const xmlParser = server.xmlParser;
  const configService = require('../../services/mongo/');

  // Ensure unique index once at startup
  collection.createIndex({ code: 1 }, { unique: true }).catch(() => {});

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
    try { res.json(await configService.getConfiguration(collection)); }
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

  // Routes
  router.get('/operator/config/xml', getOperatorXML);
  router.get('/operator/config', getOperator);

  router.post('/operator/config', createOperator);
  router.put('/operator/config/:id', upsertOperator);   // << add this

  router.delete('/operator/config/:id', deleteOperator);

  return router;
}