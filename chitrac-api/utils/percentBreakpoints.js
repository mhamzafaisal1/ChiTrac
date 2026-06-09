const DEFAULT_PERCENT_BREAKPOINTS = {
  poor: 0,
  okay: 70,
  good: 90
};

function getPercentBreakpoints(config = {}) {
  const configured = config.percentBreakpoints;

  if (
    configured &&
    Number.isFinite(configured.poor) &&
    Number.isFinite(configured.okay) &&
    Number.isFinite(configured.good) &&
    configured.good > configured.okay &&
    configured.okay > configured.poor
  ) {
    return configured;
  }

  return DEFAULT_PERCENT_BREAKPOINTS;
}

function normalizePercentValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function getPercentBreakpointColor(value, config = {}) {
  const percentage = normalizePercentValue(value);
  if (percentage === null) return 'red';

  const breakpoints = getPercentBreakpoints(config);
  if (percentage >= breakpoints.good) return 'green';
  if (percentage >= breakpoints.okay) return 'orange';
  if (percentage >= breakpoints.poor) return 'red';
  return 'red';
}

module.exports = {
  DEFAULT_PERCENT_BREAKPOINTS,
  getPercentBreakpoints,
  getPercentBreakpointColor
};
