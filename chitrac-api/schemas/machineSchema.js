module.exports = {
    type: 'object',
    required: [
      'serial',
      'name',
      'ipAddress',
      'active',
      'lanes',
      'stations'
    ],
    properties: {
      _id: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$' // optional but must be valid ObjectId if present
      },
      serial: {
        type: 'integer'
      },
      name: {
        type: 'string'
      },
      active: {
        type: 'boolean'
      },
      ipAddress: {
        type: 'string',
        format: 'ipv4'
      },
      lanes: {
        type: 'integer',
        minimum: 1
      },
      stations: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'integer'
        },
        description: 'Required sorted array of station numbers like [1, 2, 3]'
      },
      groups: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string'
            },
            costCenter: {
              type: 'string'
            },
            departmentId: {
              type: 'string'
            }
          },
          additionalProperties: false
        },
        default: []
      }
    },
    additionalProperties: false
  };
