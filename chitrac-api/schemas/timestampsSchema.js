const Ajv = require('ajv');
const ajv = new Ajv();

const timestampKeys = [
  'create',
  'active',
  'update',
  'start',
  'end',
  'inactive',
  'sync'
];

const dateField = (description) => ({
  type: 'object',
  description: `${description} Stored as a JavaScript Date / MongoDB BSON Date, not an ISO string.`
});

// Timestamps Schema Definition
const schema = {
  type: 'object',
  required: [
    'create',
    'active',
    'update'
  ],
  properties: {
    create: dateField('Timestamp of when the object/document was created. Should never be changed, only initialized when an object/document is initially written.'),
    active: dateField('Timestamp of when the object/document was activated. Initially this is the same as create, only changes if the object is made inactive and then reactivated.'),
    update: dateField('Timestamp of when the object/document was last updated. Initially this is the same as create, only changes if the object is updated/edited.'),
    start: dateField('Optional timestamp of when a session, or other period of time, started. Should never be changed once stamped.'),
    end: dateField('Optional timestamp of when a session, or other period of time, ended. Should never be changed once stamped.'),
    inactive: dateField('Optional timestamp of when an object/document was made inactive. Should only exist if and when an object/document is made inactive.'),
    sync: dateField('Optional timestamp of when the object/document was last synced with a main/cloud server.')
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

const toDate = (value, label = 'timestamp') => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} timestamp`);
  }

  return date;
};

const normalize = (timestampsObject = {}) => {
  const normalized = {};

  timestampKeys.forEach((key) => {
    if (timestampsObject[key] !== undefined && timestampsObject[key] !== null) {
      normalized[key] = toDate(timestampsObject[key], key);
    }
  });

  return normalized;
};

const validateTimestamps = (timestamps) => {
  const valid = validate(timestamps);
  if (!valid) {
    throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
  }
};

const stampField = (timestampsObjectToStamp, field, timestamp) => {
  const updatedTimestamps = {
    ...normalize(timestampsObjectToStamp),
    [field]: toDate(timestamp, field)
  };

  validateTimestamps(updatedTimestamps);
  return updatedTimestamps;
};

// Timestamps Utility Functions
const utils = {
  /**
   * Initialize a timestamps object with create, active, and update timestamps
   * @param {Date|string|number} create - Required timestamp which will be used for create, active, and update
   * @param {Date|string|number} [start] - Optional timestamp for start
   * @param {Date|string|number} [end] - Optional timestamp for end
   * @param {Date|string|number} [inactive] - Optional timestamp for inactive
   * @returns {object} Timestamps object with Date properties
   */
  stampInit: (create, start = null, end = null, inactive = null) => {
    const createDate = toDate(create, 'create');
    const timestamps = {
      create: createDate,
      active: new Date(createDate.getTime()),
      update: new Date(createDate.getTime())
    };

    if (start !== null) {
      timestamps.start = toDate(start, 'start');
    }

    if (end !== null) {
      timestamps.end = toDate(end, 'end');
    }

    if (inactive !== null) {
      timestamps.inactive = toDate(inactive, 'inactive');
    }

    validateTimestamps(timestamps);
    return timestamps;
  },

  normalize,

  toDate,

  /**
   * Stamp the update timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {Date|string|number} updateTimestamp - Required timestamp to be applied to .update
   * @returns {object} New timestamps object with Date properties
   */
  stampUpdate: (timestampsObjectToStamp, updateTimestamp) => stampField(timestampsObjectToStamp, 'update', updateTimestamp),

  /**
   * Stamp the start timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {Date|string|number} startTimestamp - Required timestamp to be applied to .start
   * @returns {object} New timestamps object with Date properties
   */
  stampStart: (timestampsObjectToStamp, startTimestamp) => stampField(timestampsObjectToStamp, 'start', startTimestamp),

  /**
   * Stamp the end timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {Date|string|number} endTimestamp - Required timestamp to be applied to .end
   * @returns {object} New timestamps object with Date properties
   */
  stampEnd: (timestampsObjectToStamp, endTimestamp) => stampField(timestampsObjectToStamp, 'end', endTimestamp),

  /**
   * Stamp the active timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {Date|string|number} activeTimestamp - Required timestamp to be applied to .active
   * @returns {object} New timestamps object with Date properties
   */
  stampActive: (timestampsObjectToStamp, activeTimestamp) => stampField(timestampsObjectToStamp, 'active', activeTimestamp),

  /**
   * Stamp the inactive timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {Date|string|number} inactiveTimestamp - Required timestamp to be applied to .inactive
   * @returns {object} New timestamps object with Date properties
   */
  stampInactive: (timestampsObjectToStamp, inactiveTimestamp) => stampField(timestampsObjectToStamp, 'inactive', inactiveTimestamp),

  /**
   * Stamp the sync timestamp on an existing timestamps object
   * @param {object} timestampsObjectToStamp - Required existing timestamps object to update
   * @param {Date|string|number} syncTimestamp - Required timestamp to be applied to .sync
   * @returns {object} New timestamps object with Date properties
   */
  stampSync: (timestampsObjectToStamp, syncTimestamp) => stampField(timestampsObjectToStamp, 'sync', syncTimestamp)
};

module.exports = {
  schema,
  utils
};
