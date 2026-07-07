const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strictSchema: false });
addFormats(ajv);

const timestampsSchema = require('./timestampsSchema');
const breakSchema = require('./break');

const schema = {
  type: 'object',
  required: [
    'id',
    'active',
    'timestamps',
    'shiftTime',
    'breaks'
  ],
  properties: {
    _id: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{24}$',
      description: 'Optional MongoDB ObjectId for this shift record'
    },
    id: {
      type: 'integer',
      minimum: 1,
      description: 'Required public integer id for this shift record.'
    },
    active: {
      type: 'boolean',
      default: true,
      description: 'Boolean value for whether or not the shift is active in the shift plan. Default is true.'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamps schema validated timestamps object for this shift definition.'
    },
    shiftTime: {
      type: 'number',
      description: 'Number value equal to timestamps.end - timestamps.start, in milliseconds.'
    },
    breaks: {
      type: 'array',
      items: {
        ...breakSchema.schema
      },
      description: 'Array of schema valid breakObjects. None are required, if none are present, property should be an empty array, not null or undefined.'
    },
    activeDays: {
      type: 'array',
      maxItems: 7,
      items: {
        type: 'integer',
        minimum: 1,
        maximum: 7,
        description: 'ISO day of week integer: 1 = Monday, 7 = Sunday.'
      },
      description: 'Array of ISO day-of-week integers representing the days this shift is active. 1 = Monday, 7 = Sunday.'
    },
    name: {
      type: 'string',
      description: 'String value representing the name of the shift'
    }
  },
  additionalProperties: false
};

const validate = ajv.compile(schema);

function getShiftTime(timestamps) {
  const startTime = new Date(timestamps.start).getTime();
  const endTime = new Date(timestamps.end).getTime();
  const shiftTime = endTime - startTime;

  if (shiftTime <= 0) {
    throw new Error('Shift end time must be after start time.');
  }

  return shiftTime;
}

const utils = {
  initShift: (timestamps, breaks = null, name = null, id = null) => {
    if (!Number.isInteger(id) || id < 1) {
      throw new Error('Shift id must be an integer greater than or equal to 1.');
    }

    if (!timestamps.start || !timestamps.end) {
      throw new Error('Timestamps object must contain both start and end properties to define shift time.');
    }

    const shiftObject = {
      id,
      active: true,
      timestamps,
      shiftTime: getShiftTime(timestamps),
      breaks: breaks || []
    };

    if (name !== null) {
      shiftObject.name = name;
    }

    const valid = validate(shiftObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return shiftObject;
  },

  setProperty: (shiftObject, propertyToSet, valueToSet) => {
    const now = new Date();

    const updatedShift = {
      ...shiftObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(shiftObject.timestamps, now)
    };

    delete updatedShift.startTime;
    delete updatedShift.endTime;

    if (propertyToSet === 'timestamps' && valueToSet.start && valueToSet.end) {
      updatedShift.shiftTime = getShiftTime(valueToSet);
    }

    if (propertyToSet === 'breaks' && valueToSet === null) {
      updatedShift.breaks = [];
    }

    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  },

  setInactive: (shiftObject) => {
    const now = new Date();

    const updatedShift = {
      ...shiftObject,
      active: false,
      timestamps: timestampsSchema.utils.stampInactive(
        timestampsSchema.utils.stampUpdate(shiftObject.timestamps, now),
        now
      )
    };
    delete updatedShift.startTime;
    delete updatedShift.endTime;

    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  },

  setActive: (shiftObject) => {
    const now = new Date();

    const updatedShift = {
      ...shiftObject,
      active: true,
      timestamps: timestampsSchema.utils.stampActive(
        timestampsSchema.utils.stampUpdate(shiftObject.timestamps, now),
        now
      )
    };
    delete updatedShift.startTime;
    delete updatedShift.endTime;

    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  },

  addBreak: (shiftObject, breakObject) => {
    const now = new Date();

    const updatedShift = {
      ...shiftObject,
      breaks: [...shiftObject.breaks, breakObject],
      timestamps: timestampsSchema.utils.stampUpdate(shiftObject.timestamps, now)
    };
    delete updatedShift.startTime;
    delete updatedShift.endTime;

    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  },

  removeBreak: (shiftObject, breakIndex) => {
    const now = new Date();

    if (breakIndex < 0 || breakIndex >= shiftObject.breaks.length) {
      throw new Error('Break index is out of range.');
    }

    const updatedBreaks = [...shiftObject.breaks];
    updatedBreaks.splice(breakIndex, 1);

    const updatedShift = {
      ...shiftObject,
      breaks: updatedBreaks,
      timestamps: timestampsSchema.utils.stampUpdate(shiftObject.timestamps, now)
    };
    delete updatedShift.startTime;
    delete updatedShift.endTime;

    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  },

  updateTimestamps: (shiftObject, newTimestamps) => {
    const now = new Date();

    if (!newTimestamps.start || !newTimestamps.end) {
      throw new Error('New timestamps object must contain both start and end properties.');
    }

    const updatedShift = {
      ...shiftObject,
      timestamps: timestampsSchema.utils.stampUpdate(newTimestamps, now),
      shiftTime: getShiftTime(newTimestamps)
    };
    delete updatedShift.startTime;
    delete updatedShift.endTime;

    const valid = validate(updatedShift);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedShift;
  }
};

module.exports = {
  schema,
  utils
};
