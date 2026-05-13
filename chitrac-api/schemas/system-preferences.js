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
    userPermissionsLevels: [...DEFAULT_USER_PERMISSION_LEVELS],
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

  const preferences = {
    _id: 'system-preferences',
    systemName: input.systemName ?? existing.systemName ?? defaults.systemName,
    defaultTheme: input.defaultTheme ?? existing.defaultTheme ?? defaults.defaultTheme,
    logLevel: input.logLevel ?? existing.logLevel ?? defaults.logLevel,
    userPermissionsLevels,
    createdAt: existing.createdAt || defaults.createdAt,
    updatedAt: now
  };

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
