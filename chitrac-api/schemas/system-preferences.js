const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv();
addFormats(ajv);
const timestampsSchema = require('./timestampsSchema');

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

const DEFAULT_OE_PERCENT_BREAKPOINTS = {
  poor: 0,
  okay: 60,
  good: 80
};

function buildPercentBreakpointSchema(descriptionPrefix) {
  return {
    type: 'object',
    required: ['poor', 'okay', 'good'],
    properties: {
      poor: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: `${descriptionPrefix} poor/red dashboard color coding`
      },
      okay: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: `${descriptionPrefix} okay/yellow-orange dashboard color coding`
      },
      good: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: `${descriptionPrefix} good/green dashboard color coding`
      }
    },
    additionalProperties: false,
    description: 'Dashboard percentage breakpoints. If present, poor, okay, and good are all required.'
  };
}

const schema = {
  type: 'object',
  required: ['userPermissionsLevels', 'timestamps'],
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
    percentBreakpoints: buildPercentBreakpointSchema('Percentage threshold for'),
    oePercentBreakpoints: buildPercentBreakpointSchema('OE percentage threshold for'),
    userSessionExpirationHours: {
      type: 'number',
      exclusiveMinimum: 0,
      description: 'User session expiration duration in hours, equivalent to USER_SESSION_EXPIRATION_HOURS from .env'
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
    operatorPaceHandicap: {
      type: 'array',
      items: {
        type: 'object',
        required: ['daysOfEmployment', 'handicapFactor'],
        properties: {
          daysOfEmployment: {
            type: 'number',
            minimum: 0,
            description: 'Minimum days employed for this handicap rule to apply'
          },
          handicapFactor: {
            type: 'number',
            minimum: 0,
            description: 'Multiplier applied to the full operator pace standard'
          }
        },
        additionalProperties: false
      },
      description: 'Operator pace standard proration rules based on days of employment'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this system preferences document.'
    }
  },
  additionalProperties: false
};

const validate = ajv.compile(schema);

function toDate(value, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return fallback;
}

function serializeDatesForValidation(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeDatesForValidation);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeDatesForValidation(entry)])
    );
  }
  return value;
}

function buildDefaultPreferences(config = {}) {
  const now = new Date();
  return {
    _id: 'system-preferences',
    systemName: config.systemName || 'ChiTrac',
    defaultTheme: config.defaultTheme || 'dark',
    logLevel: config.logLevel || 'info',
    dashboardTimeframe: 'current',
    percentBreakpoints: config.percentBreakpoints || { ...DEFAULT_PERCENT_BREAKPOINTS },
    oePercentBreakpoints: config.oePercentBreakpoints || { ...DEFAULT_OE_PERCENT_BREAKPOINTS },
    userSessionExpirationHours: Number(config.userSessionExpirationHours) > 0
      ? Number(config.userSessionExpirationHours)
      : 48,
    userPermissionsLevels: Array.isArray(config.userPermissionsLevels)
      ? [...config.userPermissionsLevels]
      : [...DEFAULT_USER_PERMISSION_LEVELS],
    timestamps: {
      create: now,
      active: now,
      update: now
    }
  };
}

function normalizePercentBreakpoints(input, fieldName = 'percentBreakpoints') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  if (!['poor', 'okay', 'good'].every((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    const error = new Error(`Schema validation failed: ${fieldName} requires poor, okay, and good`);
    error.status = 400;
    throw error;
  }

  for (const key of ['poor', 'okay', 'good']) {
    if (input[key] === null || input[key] === '') {
      const error = new Error(`Schema validation failed: ${fieldName} values must be finite numbers`);
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

function validatePercentBreakpointOrder(preferences, fieldName = 'percentBreakpoints') {
  const breakpoints = preferences[fieldName];
  if (!breakpoints) return;

  const { poor, okay, good } = breakpoints;

  if (![poor, okay, good].every(Number.isFinite)) {
    const error = new Error(`Schema validation failed: ${fieldName} values must be finite numbers`);
    error.status = 400;
    throw error;
  }

  if (!(good > okay && okay > poor)) {
    const error = new Error(`Schema validation failed: ${fieldName} must satisfy good > okay > poor`);
    error.status = 400;
    throw error;
  }
}

function normalizePreferences(input = {}, existing = {}, config = {}) {
  const now = new Date();
  const defaults = buildDefaultPreferences(config);
  const userPermissionsLevels = Array.isArray(input.userPermissionsLevels)
    ? input.userPermissionsLevels.map(label => `${label}`.trim())
    : existing.userPermissionsLevels || defaults.userPermissionsLevels;
  const percentBreakpoints = Object.prototype.hasOwnProperty.call(input, 'percentBreakpoints')
    ? normalizePercentBreakpoints(input.percentBreakpoints, 'percentBreakpoints')
    : existing.percentBreakpoints || defaults.percentBreakpoints;
  const oePercentBreakpoints = Object.prototype.hasOwnProperty.call(input, 'oePercentBreakpoints')
    ? normalizePercentBreakpoints(input.oePercentBreakpoints, 'oePercentBreakpoints')
    : existing.oePercentBreakpoints || defaults.oePercentBreakpoints;
  const operatorPaceHandicap = Array.isArray(input.operatorPaceHandicap)
    ? input.operatorPaceHandicap.map(rule => ({
        daysOfEmployment: Number(rule.daysOfEmployment),
        handicapFactor: Number(rule.handicapFactor)
      }))
    : existing.operatorPaceHandicap;
  const userSessionExpirationHours =
    input.userSessionExpirationHours !== undefined
      ? Number(input.userSessionExpirationHours)
      : existing.userSessionExpirationHours ?? defaults.userSessionExpirationHours;
  const existingTimestamps = existing.timestamps || {};
  const defaultTimestamps = defaults.timestamps;
  const createdTimestamp = toDate(
    existingTimestamps.create || existing.createdAt || input.timestamps?.create,
    defaultTimestamps.create
  );
  const activeTimestamp = toDate(
    existingTimestamps.active || input.timestamps?.active,
    createdTimestamp
  );

  const preferences = {
    _id: 'system-preferences',
    systemName: input.systemName ?? existing.systemName ?? defaults.systemName,
    defaultTheme: input.defaultTheme ?? existing.defaultTheme ?? defaults.defaultTheme,
    logLevel: input.logLevel ?? existing.logLevel ?? defaults.logLevel,
    dashboardTimeframe: input.dashboardTimeframe ?? existing.dashboardTimeframe ?? defaults.dashboardTimeframe,
    percentBreakpoints,
    oePercentBreakpoints,
    userSessionExpirationHours,
    userPermissionsLevels,
    timestamps: {
      create: createdTimestamp,
      active: activeTimestamp,
      update: now
    }
  };

  if (typeof input.httpsEnabled === 'boolean') {
    preferences.httpsEnabled = input.httpsEnabled;
  } else if (typeof existing.httpsEnabled === 'boolean') {
    preferences.httpsEnabled = existing.httpsEnabled;
  }

  validatePercentBreakpointOrder(preferences, 'percentBreakpoints');
  validatePercentBreakpointOrder(preferences, 'oePercentBreakpoints');

  if (Array.isArray(operatorPaceHandicap)) {
    preferences.operatorPaceHandicap = operatorPaceHandicap;
  }

  const valid = validate(serializeDatesForValidation(preferences));
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
    DEFAULT_OE_PERCENT_BREAKPOINTS,
    buildDefaultPreferences,
    normalizePreferences
  }
};
