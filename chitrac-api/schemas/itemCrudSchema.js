// CRUD API schema for the current config-item collection shape.
// The normalized/internal item schema and utilities live in item.js.
const timestampsSchema = require('./timestampsSchema');

module.exports = {
    type: 'object',
    required: [
      'number',
      'name',
      'active'
    ],
    properties: {
      _id: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$' // optional but must be valid ObjectId if present
      },
      number: {
        type: 'integer'
      },
      name: {
        type: 'string'
      },
      active: {
        type: 'boolean'
      },
      timestamps: {
        ...timestampsSchema.schema,
        description: 'Server-managed timestamps for this item config record.'
      },
      weight: {
        type: ['number', 'null']
      },
      standard: {
        type: 'integer',
        minimum: 0
      },
      area: {
        type: 'integer',
        minimum: 0
      },
      department: {
        type: 'string'
      },
      photo: {
        type: 'string'
      }
    },
    additionalProperties: false
  }; 
