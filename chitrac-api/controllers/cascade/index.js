const express = require('express');
const {
  CURRENT_COLLECTION,
  EVENT_COLLECTION,
  readCascadeMqttConfig,
  isCascadeStatusStale
} = require('../../modules/cascadeMqtt');

/**
 * Cascade PLC status received over MQTT.
 *   GET /api/cascade/status          latest signals per source + stale flag
 *   GET /api/cascade/events?limit=N  most recent signal changes (default 50, max 500)
 */
module.exports = function (server, { now = () => new Date(), env = process.env } = {}) {
  const router = express.Router();
  const { staleAfterMs, url } = readCascadeMqttConfig(env);

  router.get('/status', async (req, res) => {
    try {
      const docs = await server.db.collection(CURRENT_COLLECTION)
        .find({}, { projection: { _id: 0 } }).sort({ source: 1 }).toArray();
      const at = now();
      res.json({
        enabled: !!url,
        staleAfterMs,
        sources: docs.map(doc => ({ ...doc, stale: isCascadeStatusStale(doc, at, staleAfterMs) }))
      });
    } catch (error) {
      server.logger.error(`Cascade status read failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to read Cascade status' });
    }
  });

  router.get('/events', async (req, res) => {
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 500) : 50;
    try {
      const events = await server.db.collection(EVENT_COLLECTION)
        .find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).limit(limit).toArray();
      res.json({ events });
    } catch (error) {
      server.logger.error(`Cascade events read failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to read Cascade events' });
    }
  });

  return router;
};
