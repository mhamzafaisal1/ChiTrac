const DEFAULT_PERCENT_BREAKPOINTS = {
  poor: 0,
  okay: 70,
  good: 90
};

const DEFAULT_OE_PERCENT_BREAKPOINTS = {
  poor: 0,
  okay: 60,
  good: 80
};

function isValidBreakpoints(configured) {
  if (
    configured &&
    Number.isFinite(configured.poor) &&
    Number.isFinite(configured.okay) &&
    Number.isFinite(configured.good) &&
    configured.good > configured.okay &&
    configured.okay > configured.poor
  ) {
    return true;
  }

  return false;
}

function getConfiguredBreakpoints(configured, defaults) {
  if (isValidBreakpoints(configured)) return configured;
  return defaults;
}

function getPercentBreakpoints(config = {}) {
  return getConfiguredBreakpoints(config.percentBreakpoints, DEFAULT_PERCENT_BREAKPOINTS);
}

function getOePercentBreakpoints(config = {}) {
  return getConfiguredBreakpoints(config.oePercentBreakpoints, DEFAULT_OE_PERCENT_BREAKPOINTS);
}

function getColorForBreakpoints(value, breakpoints) {
  const percentage = normalizePercentValue(value);
  if (percentage === null) return 'red';

  if (percentage >= breakpoints.good) return 'green';
  if (percentage >= breakpoints.okay) return 'orange';
  if (percentage >= breakpoints.poor) return 'red';
  return 'red';
}

function normalizePercentValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function getPercentBreakpointColor(value, config = {}) {
  return getColorForBreakpoints(value, getPercentBreakpoints(config));
}

function getOePercentBreakpointColor(value, config = {}) {
  return getColorForBreakpoints(value, getOePercentBreakpoints(config));
}

module.exports = {
  DEFAULT_PERCENT_BREAKPOINTS,
  DEFAULT_OE_PERCENT_BREAKPOINTS,
  getPercentBreakpoints,
  getOePercentBreakpoints,
  getPercentBreakpointColor,
  getOePercentBreakpointColor
};
