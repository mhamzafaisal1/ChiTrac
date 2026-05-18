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
    userSessionExpirationHours: Number(config.userSessionExpirationHours) > 0
      ? Number(config.userSessionExpirationHours)
      : 48,
    userPermissionsLevels: Array.isArray(config.userPermissionsLevels)
      ? [...config.userPermissionsLevels]
      : [...DEFAULT_USER_PERMISSION_LEVELS],
    createdAt: now,
    updatedAt: now
  };
}

function normalizePreferences(input = {}, existing = {}, config = {}) {
  const now = new Date().toISOString();
  const defaults = buildDefaultPreferences(config);
  const userPermissionsLevels = Array.isArray(input.userPermissionsLevels)
    ? input.userPermissionsLevels.map(label => `${label}`.trim())
    : existing.userPermissionsLevels || defaults.userPermissionsLevels;
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

  const preferences = {
    _id: 'system-preferences',
    systemName: input.systemName ?? existing.systemName ?? defaults.systemName,
    defaultTheme: input.defaultTheme ?? existing.defaultTheme ?? defaults.defaultTheme,
    logLevel: input.logLevel ?? existing.logLevel ?? defaults.logLevel,
    userSessionExpirationHours,
    userPermissionsLevels,
    createdAt: existing.createdAt || defaults.createdAt,
    updatedAt: now
  };

  if (typeof input.httpsEnabled === 'boolean') {
    preferences.httpsEnabled = input.httpsEnabled;
  } else if (typeof existing.httpsEnabled === 'boolean') {
    preferences.httpsEnabled = existing.httpsEnabled;
  }

  if (Array.isArray(operatorPaceHandicap)) {
    preferences.operatorPaceHandicap = operatorPaceHandicap;
  }

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
    buildDefaultPreferences,
    normalizePreferences
  }
};
