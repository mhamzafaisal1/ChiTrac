const { createVerifyJwtMiddleware } = require('./authMiddleware');
const { validateAllowedControllers } = require('../modules/apiTokenControllers');

function canonicalPath(path) {
  const decoded = decodeURIComponent(path).toLowerCase().replace(/\/+$/, '') || '/';
  // Express does not route encoded separators as real separators. Reject ambiguity.
  if (decoded.includes('\\') || /%|\/\//.test(decoded) || /%2f/i.test(path)) {
    throw new Error('Ambiguous API path');
  }
  return decoded;
}

function controllerForPath(path) {
  const first = path.split('/')[1];
  if (['spindle', 'milnor', 'softrol'].includes(first)) return first;
  if (['auth', 'users', 'passport', 'preferences', 'system-preferences', 'utilities'].includes(first)) {
    return 'settings';
  }
  return 'general';
}

function isPublicRoute(method, path) {
  return ((method === 'GET' || method === 'POST') && path === '/passport/user/login') ||
    (method === 'GET' && ['/passport/user', '/passport/user/logout', '/utilities/settings'].includes(path)) ||
    (method === 'POST' && path === '/users/password-reset/complete');
}

function requiresInteractiveUser(path) {
  return /^\/(users|passport)(\/|$)/.test(path) ||
    /^\/auth\/(tokens|createpermanenttoken|generatetesttoken)(\/|$)/.test(path);
}

function createApiControllerAccess(server) {
  const verify = createVerifyJwtMiddleware(server);
  return (req, res, next) => {
    let path;
    try { path = canonicalPath(req.path); }
    catch { return res.status(400).json({ error: 'Invalid API path' }); }
    if (req.method === 'OPTIONS' || isPublicRoute(req.method, path)) return next();
    return verify(req, res, () => {
      if (req.tokenPayload?.type !== 'permanent') return next();
      if (requiresInteractiveUser(path)) {
        return res.status(403).json({ error: 'A signed-in user is required' });
      }
      const controller = controllerForPath(path);
      const allowed = req.tokenPayload.allowedControllers;
      if (!validateAllowedControllers(allowed) || !allowed.includes(controller)) {
        return res.status(403).json({ error: 'API token does not have access to this controller', controller });
      }
      return next();
    });
  };
}

module.exports = { canonicalPath, controllerForPath, isPublicRoute, createApiControllerAccess };
