const Ajv = require('ajv');
const { schema: statusSchema } = require('./status');
const timestamps = require('./timestampsSchema');

// Fault configuration historically uses the Status schema. Keep its fields,
// with independent alarm validation so statuses do not require these flags.
const schema = {
  ...statusSchema,
  required: [...statusSchema.required, 'fault', 'stop'],
  properties: {
    ...statusSchema.properties,
    fault: { type: 'boolean', description: 'Whether this alarm is a fault.' },
    stop: { type: 'boolean', description: 'Whether this alarm stops the machine.' },
    alarmValue: { type: 'number', description: 'Optional BIKO alarm value.' },
    alarmCode: { type: 'number', description: 'Optional BIKO alarm code.' }
  }
};
const ajv = new Ajv({ strictSchema: false });
const validate = ajv.compile(schema);
function assertValid(alarm) {
  if (!validate(alarm)) throw new Error(`Alarm validation failed: ${ajv.errorsText(validate.errors)}`);
  return alarm;
}
const utils = {
  initAlarm(id, name, fault, stop, options = {}) {
    return assertValid({ ...options, id, name, fault, stop,
      active: options.active ?? true,
      timestamps: options.timestamps ?? timestamps.utils.stampInit(new Date()) });
  },
  setProperty(alarm, property, value) {
    return assertValid({ ...alarm, [property]: value,
      timestamps: timestamps.utils.stampUpdate(alarm.timestamps, new Date()) });
  },
  setActive(alarm) {
    const now = new Date();
    return assertValid({ ...alarm, active: true,
      timestamps: timestamps.utils.stampActive(timestamps.utils.stampUpdate(alarm.timestamps, now), now) });
  },
  setInactive(alarm) {
    const now = new Date();
    return assertValid({ ...alarm, active: false,
      timestamps: timestamps.utils.stampInactive(timestamps.utils.stampUpdate(alarm.timestamps, now), now) });
  }
};
module.exports = { schema, utils, validate, assertValid };
