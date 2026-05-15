const Ajv = require('ajv');
const ajv = new Ajv();
const bcrypt = require('bcryptjs');
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 64;

// Import related schemas
const timestampsSchema = require('./timestampsSchema');
const humanNamesSchema = require('./human-names');

// User Schema Definition
const schema = {
  type: 'object',
  required: [
    'id',
    'active',
    'timestamps',
    'name',
    'local',
    'permissions',
    'groups'
  ],
  properties: {
    _id: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{24}$',
      description: 'Optional MongoDB ObjectId for this user record'
    },
    id: {
      type: 'integer',
      default: 999999,
      description: 'Number which uniquely identifies a user. For now this is essentially a placeholder, will need to implement, debating possibly making this number usable to log in on machines, for now just needs to be an integer defaulting to 999999'
    },
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the user is active in the system. Default is true.'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this user definition.'
    },
    name: {
      ...humanNamesSchema.schema,
      description: 'Schema valid human name object'
    },
    local: {
      type: 'object',
      required: ['username', 'password'],
      properties: {
        username: {
          type: 'string',
          description: 'String of the username for this user, used to log in'
        },
        password: {
          type: 'string',
          minLength: PASSWORD_MIN_LENGTH,
          maxLength: PASSWORD_MAX_LENGTH,
          description: 'String of the encrypted password for user'
        }
      },
      additionalProperties: false,
      description: 'Parent object with two required children: username and password'
    },
    permissions: {
      type: 'object',
      required: ['level'],
      properties: {
        level: {
          type: 'number',
          description: 'Numeric permission level. Level 0 is highest access; larger numbers have less access.'
        }
      },
      additionalProperties: false,
      description: 'Permission settings for this user'
    },
    groups: {
      type: 'array',
      items: {
        type: 'string'
      },
      minItems: 0,
      description: 'Required array of group names. Empty array is valid.'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// User Utility Functions
const utils = {
  validatePlainTextPassword: (password) => {
    const passwordString = `${password || ''}`;
    if (passwordString.length < PASSWORD_MIN_LENGTH || passwordString.length > PASSWORD_MAX_LENGTH) {
      throw new Error(`Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`);
    }
    return true;
  },

  /**
   * Initialize a user object
   * @param {number} id - Required number value of the user id
   * @param {object} name - Required schema valid human name object
   * @param {string} username - Required string value of user's desired username
   * @param {string} password - Required string value of the password (will be encrypted)
   * @param {string[]} [groups] - Required array of group strings
   * @param {number} [permissionLevel] - Numeric permission level; 0 is highest access
   * @returns {object} Validated user object
   */
  initUser: (id, name, username, password, groups = [], permissionLevel = 3) => {
    // Initialize timestamps using timestamps utils
    const now = new Date().toISOString();
    const timestamps = timestampsSchema.utils.stampInit(now);

    utils.validatePlainTextPassword(password);

    // Encrypt the password using bcrypt (same method as current passport registration)
    const salt = bcrypt.genSaltSync(10);
    const encryptedPassword = bcrypt.hashSync(password, salt);

    // Build the user object with required properties
    const userObject = {
      id,
      active: true,
      timestamps,
      name,
      local: {
        username,
        password: encryptedPassword
      },
      permissions: {
        level: permissionLevel
      },
      groups
    };

    // Validate against schema before returning
    const valid = validate(userObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return userObject;
  },

  /**
   * Set a property on a user object
   * @param {object} userObject - Required User schema valid userObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} User schema validated object with updated property
   */
  setProperty: (userObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedUser = {
      ...userObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(userObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedUser);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedUser;
  },

  /**
   * Set a user to inactive
   * @param {object} userObject - Required User schema valid userObject
   * @returns {object} User schema validated userObject after inactivation
   */
  setInactive: (userObject) => {
    const now = new Date().toISOString();
    
    const updatedUser = {
      ...userObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(userObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedUser);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedUser;
  },

  /**
   * Set a user to active
   * @param {object} userObject - Required User schema valid userObject
   * @returns {object} User schema validated userObject after activation
   */
  setActive: (userObject) => {
    const now = new Date().toISOString();
    
    const updatedUser = {
      ...userObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(userObject.timestamps, now),
        now
      )
    };

    // Validate against schema before returning
    const valid = validate(updatedUser);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedUser;
  },

  /**
   * Verify a password against a user object
   * @param {object} userObject - Required User schema valid userObject
   * @param {string} password - Required plain text password to verify
   * @returns {boolean} True if password matches, false otherwise
   */
  verifyPassword: (userObject, password) => {
    if (!userObject.local || !userObject.local.password) {
      throw new Error('User object does not have a password.');
    }

    return bcrypt.compareSync(password, userObject.local.password);
  },

  /**
   * Update a user's password
   * @param {object} userObject - Required User schema valid userObject
   * @param {string} newPassword - Required new plain text password
   * @returns {object} User schema validated userObject with updated password
   */
  updatePassword: (userObject, newPassword) => {
    const now = new Date().toISOString();

    utils.validatePlainTextPassword(newPassword);
    
    // Encrypt the new password
    const salt = bcrypt.genSaltSync(10);
    const encryptedPassword = bcrypt.hashSync(newPassword, salt);
    
    const updatedUser = {
      ...userObject,
      local: {
        ...userObject.local,
        password: encryptedPassword
      },
      timestamps: timestampsSchema.utils.stampUpdate(userObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedUser);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedUser;
  }
};

module.exports = {
  schema,
  utils
};
