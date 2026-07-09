const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv();
addFormats(ajv);

const operatorSchema = require('./operator');

const schema = {
  type: 'object',
  required: ['operators'],
  properties: {
    operators: {
      type: 'array',
      minItems: 1,
      items: {
        ...operatorSchema.schema
      },
      description: 'Array of schema valid operatorObjects credited to this session. Single-operator sessions must use a one-object array.'
    }
  },
  additionalProperties: false
};

const validate = ajv.compile(schema);

function normalizeOperators(operatorOrOperators) {
  const operators = Array.isArray(operatorOrOperators)
    ? operatorOrOperators
    : [operatorOrOperators];

  return operators.filter(Boolean);
}

const utils = {
  initSession: (operatorOrOperators) => {
    const sessionObject = {
      operators: normalizeOperators(operatorOrOperators)
    };

    const valid = validate(sessionObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return sessionObject;
  },

  setProperty: (sessionObject, propertyToSet, valueToSet) => {
    const updatedSession = {
      ...sessionObject,
      [propertyToSet]: valueToSet
    };

    const valid = validate(updatedSession);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedSession;
  },

  getSessionSummary: (sessionObject) => ({
    operatorNames: sessionObject.operators.map(op => operatorSchema.utils.getFullName(op))
  })
};

module.exports = {
  schema,
  utils
};
