const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv();
addFormats(ajv);

const timestampsSchema = require('./timestampsSchema');

const schema = {
  type: 'object',
  required: [
    'timestamps',
    'name',
    'enabled',
    'report',
    'email',
    'schedule'
  ],
  properties: {
    _id: {
      description: 'Optional MongoDB ObjectId for this report subscription record (native Mongo ObjectId or serialized string)'
    },
    timestamps: {
      ...timestampsSchema.schema,
      description: 'Timestamp schema object'
    },
    name: {
      type: 'string',
      description: 'String value of the name of this subscription'
    },
    enabled: {
      type: 'boolean',
      default: true,
      description: 'Boolean, defaults to true'
    },
    report: {
      type: 'object',
      required: ['name', 'type'],
      properties: {
        name: {
          type: 'string',
          enum: ['machine', 'operator', 'item', 'fault'],
          description:
            'String value of the name of the report to run, current options are: machine, operator, item, fault'
        },
        type: {
          type: 'string',
          enum: ['summary', 'detailed'],
          description:
            'String value, either "summary" or "detailed" to indicate which type of the selected report to run/generate the PDF of'
        }
      },
      additionalProperties: false
    },
    email: {
      type: 'object',
      required: ['to', 'subject', 'bodyText'],
      properties: {
        to: {
          type: 'string',
          description:
            'String value of email, or semicolon separated list of emails, to send the email to for this subscription'
        },
        cc: {
          type: 'string',
          description:
            'String value of email, or semicolon separated list of emails, to cc the email to for this subscription'
        },
        bcc: {
          type: 'string',
          description:
            'String value of email, or semicolon separated list of emails, to bcc the email to for this subscription'
        },
        subject: {
          type: 'string',
          description: 'String value to use as the subject of the email'
        },
        bodyText: {
          type: 'string',
          description: 'String value of the body text to use for the email'
        }
      },
      additionalProperties: false
    },
    schedule: {
      type: 'object',
      required: ['cron'],
      properties: {
        cron: {
          type: 'string',
          description:
            'String value formatted to cron-formatting of the schedule for this scheduled report'
        }
      },
      additionalProperties: false
    },
    lastAttempt: {
      description:
        'Optional field for the last attempt at executing this schedule (type not specified by schema).'
    },
    log: {
      type: 'object',
      additionalProperties: true,
      description:
        'Generic object which will store a log object for the last attempt at executing this schedule, whether successful or error.'
    }
  },
  additionalProperties: false
};

const validate = ajv.compile(schema);

const utils = {
  /**
   * Initialize a report subscription document
   * @param {string} name - Subscription name
   * @param {{ name: string, type: string }} report - Report name (machine|operator|item|fault) and type (summary|detailed)
   * @param {{ to: string, cc: string, bcc: string, subject: string, bodyText: string }} email - Email fields
   * @param {{ cron: string }} schedule - Cron schedule string
   * @param {*} [lastAttempt] - Optional last-attempt payload (any shape)
   * @param {object} [log] - Optional log object from last run
   * @returns {object} Validated report subscription object
   */
  initReportSubscription: (name, report, email, schedule, lastAttempt = null, log = null) => {
    const now = new Date().toISOString();
    const timestamps = timestampsSchema.utils.stampInit(now);

    const doc = {
      timestamps,
      name,
      enabled: true,
      report,
      email,
      schedule
    };

    if (lastAttempt !== null) {
      doc.lastAttempt = lastAttempt;
    }
    if (log !== null) {
      doc.log = log;
    }

    const valid = validate(doc);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return doc;
  },

  /**
   * Set a property on a report subscription object and stamp update time
   * @param {object} subscriptionObject - Valid report subscription object
   * @param {string} propertyToSet - Property name to set
   * @param {*} valueToSet - New value
   * @returns {object} Updated validated object
   */
  setProperty: (subscriptionObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();

    const updated = {
      ...subscriptionObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(subscriptionObject.timestamps, now)
    };

    const valid = validate(updated);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updated;
  },

  /**
   * Set enabled to true
   * @param {object} subscriptionObject - Valid report subscription object
   * @returns {object} Updated object
   */
  setEnabled: (subscriptionObject) => {
    const now = new Date().toISOString();

    const updated = {
      ...subscriptionObject,
      enabled: true,
      timestamps: timestampsSchema.utils.stampUpdate(subscriptionObject.timestamps, now)
    };

    const valid = validate(updated);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updated;
  },

  /**
   * Set enabled to false (subscription inactive)
   * @param {object} subscriptionObject - Valid report subscription object
   * @returns {object} Updated object
   */
  setDisabled: (subscriptionObject) => {
    const now = new Date().toISOString();

    const updated = {
      ...subscriptionObject,
      enabled: false,
      timestamps: timestampsSchema.utils.stampUpdate(subscriptionObject.timestamps, now)
    };

    const valid = validate(updated);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updated;
  }
};

module.exports = {
  schema,
  utils
};
