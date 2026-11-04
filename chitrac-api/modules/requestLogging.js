const { performance } = require('node:perf_hooks');
const timestampsSchema = require('../schemas/timestampsSchema');
const { extractToken } = require('../utils/authMiddleware');

function createRequestLoggingMiddleware(logger) {
  return (req, res, next) => {
    const start = new Date();
    const monotonicStart = performance.now();
    // Never log credential-bearing query parameters, bodies, or headers.
    const path = (req.originalUrl || req.url || '/').split(/[?#]/, 1)[0];
    let logged = false;
    function finish(aborted) {
      if (logged) return;
      logged = true;
      res.removeListener('finish', onFinish);
      res.removeListener('close', onClose);
      const end = new Date();
      const durationMs = Math.round((performance.now() - monotonicStart) * 1000) / 1000;
      const status = res.headersSent ? res.statusCode : null;
      logger.http({
        message: `${req.method} ${path} ${status ?? '-'} - ${durationMs} ms`,
        timestamps: timestampsSchema.utils.stampInit(end, start, end),
        request: { method: req.method, path, status, durationMs, aborted },
        authentication: req.authAudit || { mode: 'anonymous', credentialSupplied: Boolean(extractToken(req)), result: 'not_checked' },
      });
    }
    const onFinish = () => finish(false);
    const onClose = () => finish(!res.writableFinished);
    res.once('finish', onFinish);
    res.once('close', onClose);
    next();
  };
}

module.exports = { createRequestLoggingMiddleware };
