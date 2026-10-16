const { createVerifyJwtMiddleware, extractToken } = require('./authMiddleware');
const { validateAllowedControllers } = require('../modules/apiTokenControllers');

// Read APIs shared by public dashboards, production screens, and reports.
// Keep this explicit: new endpoints and all writes remain protected by default.
const publicDisplayReads = new Set([
  '/machine/config', '/machine/spf', '/operator/config', '/reports/shifts',
  '/machine/analytics/shift-projection-window',
  '/machine/analytics/machines-summary-daily-cached',
  '/machine/analytics/machine-dashboard-daily-cached',
  '/operator/analytics/operators-summary-daily-cached',
  '/operator/analytics/idle-operators',
  '/operator/analytics/operator-details-cached',
  '/operator/analytics/operator-machine-summary',
  '/item/analytics/items-summary-daily-cache',
  '/fault/analytics/fault-sessions-history',
  '/fault/analytics/fault-report-summary',
  '/fault/analytics/fault-report-detailed',
  '/reports/analytics/machine-report-cache',
  '/reports/analytics/operator-item-sessions-summary-cache',
  '/reports/analytics/item-sessions-summary-daily-cache',
  '/reports/report-subscriptions',
  ...[
    'unused-stations', 'daily-summary-dashboard/machines',
    'daily-summary-dashboard/operators', 'daily-summary-dashboard/items',
    'daily/machine-status-cache', 'daily/machine-oee',
    'hourly/item-totals-by-type', 'daily/count-totals-cache',
    'daily/top-operators-cache', 'machines-group-summary-daily-cached',
    'daily/machine-live-session-summary', 'machine-live-session-summary/machine',
    'machine-live-session-summary/operator',
  ].map(path => `/dashboard/analytics/${path}`),
  ...[
    'machines-summary-daily-cached', 'machine-dashboard-daily-cached',
    'machine-summary-timeframe', 'machine-dashboard-cached',
    'machine-performance', 'machine-state-totals', 'machine-hourly-states',
    'operator-performance', 'machine/operator-efficiency',
    'machine/operator-efficiency-fromsessions', 'operator-countbyitem',
    'fault-history', 'operator-fault-history', 'machine-item-summary',
    'operator-item-summary', 'item-summary', 'machine-item-hourly-item-stack',
    'operator-cycle-pie', 'operator/daily-efficiency', 'item-dashboard-summary',
    'operators-summary-daily-cached', 'operator-details-cached', 'operator-machine-summary',
    'leveltwo',
  ].map(path => `/alpha/analytics/${path}`),
  '/alpha/run-session/state/cycles', '/alpha/run-session/state/operator-cycles',
]);

function isPublicDisplayRead(method, path) {
  return method === 'GET' && (publicDisplayReads.has(path) ||
    /^\/reports\/report-subscriptions\/[a-f0-9]{24}$/.test(path));
}

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
    // Supplied credentials must still pass validation and controller scope checks.
    if (isPublicDisplayRead(req.method, path) && !extractToken(req) && !req.isAuthenticated?.()) {
      return next();
    }
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
