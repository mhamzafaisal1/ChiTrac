const Ajv = require('ajv');
const ajv = new Ajv();

const DEFAULT_USER_PERMISSION_LEVELS = [
  'Root',
  'SysAdmin',
  'Admin',
  'Manager',
  'Supervisor',
  'Employee',
  'Operator',
  'Guest'
];

const DEFAULT_PERCENT_BREAKPOINTS = {
  poor: 0,
  okay: 70,
  good: 90
};

const schema = {
  type: 'object',
  required: ['userPermissionsLevels'],
  properties: {
    _id: {
      type: 'string',
      description: 'Stable singleton id for the system preferences document'
    },
    systemName: {
      type: 'string',
      description: 'System display name, equivalent to SYSTEM_NAME from .env'
    },
    defaultTheme: {
      type: 'string',
      description: 'Default UI theme, equivalent to DEFAULT_THEME from .env'
    },
    logLevel: {
      type: 'string',
      description: 'Runtime log level, equivalent to LOG_LEVEL from .env'
    },
    httpsEnabled: {
      type: 'boolean',
      description: 'Whether HTTPS hosting should be enabled at runtime'
    },
    dashboardTimeframe: {
      type: ['string', 'null'],
      enum: ['current', 'shift', null],
      description: "Default dashboard timeframe. 'current' uses midnight-to-now; 'shift' uses the active/current shift when available."
    },
    percentBreakpoints: {
      type: 'object',
      required: ['poor', 'okay', 'good'],
      properties: {
        poor: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Percentage threshold for poor/red dashboard color coding'
        },
        okay: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Percentage threshold for okay/yellow-orange dashboard color coding'
        },
        good: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Percentage threshold for good/green dashboard color coding'
        }
      },
      additionalProperties: false,
      description: 'Dashboard percentage breakpoints. If present, poor, okay, and good are all required.'
    },
    userPermissionsLevels: {
      type: 'array',
      minItems: 8,
      maxItems: 8,
      items: {
        type: 'string'
      },
      description: 'String labels for user permission levels 0 through 7'
    },
    createdAt: {
      type: 'string'
    },
    updatedAt: {
      type: 'string'
    }
  },
  additionalProperties: false
};

const validate = ajv.compile(schema);

function buildDefaultPreferences(config = {}) {
  const now = new Date().toISOString();
  return {
    _id: 'system-preferences',
    systemName: config.systemName || 'ChiTrac',
    defaultTheme: config.defaultTheme || 'dark',
    logLevel: config.logLevel || 'info',
    dashboardTimeframe: 'current',
    percentBreakpoints: config.percentBreakpoints || { ...DEFAULT_PERCENT_BREAKPOINTS },
    userPermissionsLevels: Array.isArray(config.userPermissionsLevels)
      ? [...config.userPermissionsLevels]
      : [...DEFAULT_USER_PERMISSION_LEVELS],
    createdAt: now,
    updatedAt: now
  };
}

function normalizePercentBreakpoints(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  if (!['poor', 'okay', 'good'].every((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    const error = new Error('Schema validation failed: percentBreakpoints requires poor, okay, and good');
    error.status = 400;
    throw error;
  }

  for (const key of ['poor', 'okay', 'good']) {
    if (input[key] === null || input[key] === '') {
      const error = new Error('Schema validation failed: percentBreakpoints values must be finite numbers');
      error.status = 400;
      throw error;
    }
  }

  return {
    poor: Number(input.poor),
    okay: Number(input.okay),
    good: Number(input.good)
  };
}

function validatePercentBreakpointOrder(preferences) {
  const breakpoints = preferences.percentBreakpoints;
  if (!breakpoints) return;

  const { poor, okay, good } = breakpoints;

  if (![poor, okay, good].every(Number.isFinite)) {
    const error = new Error('Schema validation failed: percentBreakpoints values must be finite numbers');
    error.status = 400;
    throw error;
  }

  if (!(good > okay && okay > poor)) {
    const error = new Error('Schema validation failed: percentBreakpoints must satisfy good > okay > poor');
    error.status = 400;
    throw error;
  }
}

function normalizePreferences(input = {}, existing = {}, config = {}) {
  const now = new Date().toISOString();
  const defaults = buildDefaultPreferences(config);
  const userPermissionsLevels = Array.isArray(input.userPermissionsLevels)
    ? input.userPermissionsLevels.map(label => `${label}`.trim())
    : existing.userPermissionsLevels || defaults.userPermissionsLevels;
  const percentBreakpoints = Object.prototype.hasOwnProperty.call(input, 'percentBreakpoints')
    ? normalizePercentBreakpoints(input.percentBreakpoints)
    : existing.percentBreakpoints || defaults.percentBreakpoints;

  const preferences = {
    _id: 'system-preferences',
    systemName: input.systemName ?? existing.systemName ?? defaults.systemName,
    defaultTheme: input.defaultTheme ?? existing.defaultTheme ?? defaults.defaultTheme,
    logLevel: input.logLevel ?? existing.logLevel ?? defaults.logLevel,
    dashboardTimeframe: input.dashboardTimeframe ?? existing.dashboardTimeframe ?? defaults.dashboardTimeframe,
    percentBreakpoints,
    userPermissionsLevels,
    createdAt: existing.createdAt || defaults.createdAt,
    updatedAt: now
  };

  if (typeof input.httpsEnabled === 'boolean') {
    preferences.httpsEnabled = input.httpsEnabled;
  } else if (typeof existing.httpsEnabled === 'boolean') {
    preferences.httpsEnabled = existing.httpsEnabled;
  }

  validatePercentBreakpointOrder(preferences);

  const valid = validate(preferences);
  if (!valid) {
    const error = new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    error.status = 400;
    throw error;
  }

  return preferences;
}

module.exports = {
  schema,
  validate,
  utils: {
    DEFAULT_USER_PERMISSION_LEVELS,
    DEFAULT_PERCENT_BREAKPOINTS,
    buildDefaultPreferences,
    normalizePreferences
  }
};
