const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv();
addFormats(ajv);

// Timestamps Schema Definition
const schema = {
  type: 'object',
  required: [
    'create',
    'active',
    'update'
  ],
  properties: {
    create: {
      type: 'string',
      format: 'date-time',
      description: 'Timestamp of when the object/document was created. Should never be changed, only initialized when an object/document is initially written.'
    },
    active: {
      type: 'string',
      format: 'date-time',
      description: 'Timestamp of when the object/document was activated. Initially this is the same as create, only changes if the object is made inactive and then reactivated.'
    },
    update: {
      type: 'string',
      format: 'date-time',
      description: 'Timestamp of when the object/document was last updated. Initially this is the same as create, only changes if the object is updated/edited.'
    },
    start: {
      type: 'string',
      format: 'date-time',
      description: 'Optional timestamp of when a session, or other period of time, started. Should never be changed once stamped.'
    },
    end: {
      type: 'string',
      format: 'date-time',
      description: 'Optional timestamp of when a session, or other period of time, ended. Should never be changed once stamped.'
    },
    inactive: {
      type: 'string',
      format: 'date-time',
      description: 'Optional timestamp of when an object/document was made inactive. Should only exist if and when an object/document is made inactive.'
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Timestamps Utility Functions
const utils = {
  /**
   * Initialize a timestamps object with create, active, and update timestamps
   * @param {string} create - Required timestamp which will be used for create, active, and update
   * @param {string} [start] - Optional timestamp for start
   * @param {string} [end] - Optional timestamp for end
   * @param {string} [inactive] - Optional timestamp for inactive
   * @returns {object} Timestamps object with the specified properties
   */
  stampInit: (create, start = null, end = null, inactive = null) => {
    const timestamps = {
      create,
      active: create,
      update: create
    };

    if (start !== null) {
      timestamps.start = start;
    }

    if (end !== null) {
      timestamps.end = end;
    }

    if (inactive !== null) {
      timestamps.inactive = inactive;
    }

    // Validate against schema before returning
    const valid = validate(timestamps);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return timestamps;
  },

  /**
   * Create an update timestamp object
   * @param {string} updateTimestamp - Required timestamp to be applied to .update
   * @returns {object} Object with update property
   */
  stampUpdate: (updateTimestamp) => {
    return {
      update: updateTimestamp
    };
  },

  /**
   * Create a start timestamp object
   * @param {string} startTimestamp - Required timestamp to be applied to .start
   * @returns {object} Object with start property
   */
  stampStart: (startTimestamp) => {
    return {
      start: startTimestamp
    };
  },

  /**
   * Create an end timestamp object
   * @param {string} endTimestamp - Required timestamp to be applied to .end
   * @returns {object} Object with end property
   */
  stampEnd: (endTimestamp) => {
    return {
      end: endTimestamp
    };
  },

  /**
   * Create an active timestamp object
   * @param {string} activeTimestamp - Required timestamp to be applied to .active
   * @returns {object} Object with active property
   */
  stampActive: (activeTimestamp) => {
    return {
      active: activeTimestamp
    };
  },

  /**
   * Create an inactive timestamp object
   * @param {string} inactiveTimestamp - Required timestamp to be applied to .inactive
   * @returns {object} Object with inactive property
   */
  stampInactive: (inactiveTimestamp) => {
    return {
      inactive: inactiveTimestamp
    };
  }
};

module.exports = {
  schema,
  utils
};

