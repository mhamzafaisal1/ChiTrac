const Ajv = require('ajv');
const { allowedControllersSchema } = require('../modules/apiTokenControllers');

const schema = {
  type: 'object',
  required: ['name', 'hashedToken', 'createdBy', 'isActive', 'allowedControllers'],
  properties: {
    name: { type: 'string', minLength: 1 },
    hashedToken: { type: 'string', minLength: 1 },
    hashedTokenVersion: { type: 'integer', enum: [1, 2] },
    createdBy: { type: 'string', minLength: 1 },
    isActive: { type: 'boolean' },
    allowedControllers: allowedControllersSchema
  }
};

module.exports = { schema, validate: new Ajv().compile(schema) };
